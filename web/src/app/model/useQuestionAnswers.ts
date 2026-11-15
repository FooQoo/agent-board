import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ProjectId } from '../../shared/api/contracts';
import { AnswerBook } from '../../features/tasks/answer/model/answerBook';
import type { BandQuestion } from '../../features/tasks/answer/model/qa';
import type { AnswerStart } from '../../features/tasks/answer/useAnswerFlow';
import { fetchQuestion } from '../../features/tasks/api/read';
import { isProjectId } from './projectSession';

export type AnswerLeaseChange = (key: string, projectId: ProjectId, active: boolean) => void;

/** Where the answer dialog is open, and at which question it started. */
export interface AnswerTarget {
  projectId: ProjectId;
  start: AnswerStart;
}

export interface QuestionAnswerController {
  /** The answers held on this page, per project and question. */
  book: AnswerBook;
  /** The answer dialog of the active project, or null while it is closed. */
  target: AnswerTarget | null;
  open: (start: AnswerStart) => void;
  /** Opens on the open questions of one card, which sends them without a review. */
  openForTask: (taskId: number) => void;
  close: () => void;
}

const leaseKey = (projectId: ProjectId) => `qa:${projectId}`;

/**
 * The PC side of answering: one book of held answers for the page, the open dialog, and the lease
 * that keeps the project from being switched while answers wait to be sent. The dialog belongs to
 * the project it was opened in: another project closes it.
 */
export function useQuestionAnswers(
  activeId: string | null,
  questions: readonly BandQuestion[] | null,
  onLeaseChange: AnswerLeaseChange,
): QuestionAnswerController {
  const [book] = useState(() => new AnswerBook());
  const revision = useSyncExternalStore(book.subscribe, book.revision);
  const [opened, setOpened] = useState<AnswerTarget | null>(null);

  useEffect(() => {
    if (opened !== null && opened.projectId !== activeId) setOpened(null);
  }, [opened, activeId]);

  // A held question that leaves the open list is closed; its state says whether it was answered
  // elsewhere or withdrawn.
  useEffect(() => {
    if (!isProjectId(activeId) || questions === null) return;
    for (const id of book.reconcile(activeId, questions))
      fetchQuestion(activeId, id).then(
        (detail) => {
          if (detail.status !== 'open') book.markClosed(activeId, id, detail.status);
        },
        () => {},
      );
  }, [book, activeId, questions]);

  const leased = useRef(new Set<ProjectId>());
  useEffect(() => {
    void revision;
    const wanted = new Set(book.projectsWithUnsent());
    for (const projectId of [...leased.current])
      if (!wanted.has(projectId)) {
        leased.current.delete(projectId);
        onLeaseChange(leaseKey(projectId), projectId, false);
      }
    for (const projectId of wanted)
      if (!leased.current.has(projectId)) {
        leased.current.add(projectId);
        onLeaseChange(leaseKey(projectId), projectId, true);
      }
  }, [book, revision, onLeaseChange]);

  const open = useCallback(
    (start: AnswerStart) => {
      if (isProjectId(activeId)) setOpened({ projectId: activeId, start });
    },
    [activeId],
  );
  const openForTask = useCallback(
    (taskId: number) => {
      const asked = questions?.some((question) => question.referencedBy.includes(taskId));
      open(asked ? { kind: 'task', taskId } : { kind: 'resume' });
    },
    [open, questions],
  );
  const close = useCallback(() => setOpened(null), []);
  return {
    book,
    target: opened?.projectId === activeId ? opened : null,
    open,
    openForTask,
    close,
  };
}
