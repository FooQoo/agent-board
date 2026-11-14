import '@/shared/i18n/question-flow-strings';
import { useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProjectId } from '@/shared/api/contracts';
import { problemOf, WriteError } from '@/shared/api/writeErrors';
import type { AnswerStep } from './AnswerProgress';
import type { ReviewItem } from './AnswerReview';
import type { AnswerFlowViewProps } from './DecisionAnswerDialog';
import type { DecisionAnswerView } from './decisionAnswerView';
import { type AnswerBook, conflictsOf } from './model/answerBook';
import {
  type AnswersWriter,
  type BandQuestion,
  type QuestionReader,
  isAnswered,
  isWithinLimit,
  plainTitle,
} from './model/qa';
import { taskRefs } from './QuestionBand';
import { useQuestionDetail } from './useQuestionDetail';

/** Where a run through the questions starts. */
export type AnswerStart =
  | { kind: 'question'; questionId: string }
  /** At the first open question with no answer held, or at the review when every one has one. */
  | { kind: 'resume' }
  | { kind: 'review' };

const REVIEW = '';

export interface UseAnswerFlowOptions {
  projectId: ProjectId;
  /** The open questions of the project, from its Summary. */
  questions: readonly BandQuestion[];
  /** The cards, for the title of a question's first card. */
  tasks: readonly { id: number; title: string }[];
  book: AnswerBook;
  start: AnswerStart;
  read: QuestionReader;
  write: AnswersWriter;
  /** The answers were saved; the screen closes the answer and reads the board again. */
  onSent: () => void;
  /** Turns an `attachment:<id>` image of a question into the URL of its card's file. */
  attachmentUrl?: (taskId: number, attachmentId: string) => string | null;
}

/**
 * One run through the questions, shared by the PC dialog and the monitor's sheet: the order, the
 * question shown and its text, the held answers, and the send of them all. The order is fixed when
 * the run starts; a question that arrives later is added at the end, and one that leaves stays,
 * marked as no longer open.
 */
export function useAnswerFlow({
  projectId,
  questions,
  tasks,
  book,
  start,
  read,
  write,
  onSent,
  attachmentUrl,
}: UseAnswerFlowOptions): AnswerFlowViewProps & { goTo: (index: number) => void } {
  const { t } = useTranslation();
  useSyncExternalStore(book.subscribe, book.revision);
  const openIds = new Set(questions.map((question) => question.id));

  // The run's questions: what was open or held when it started, then what arrived.
  const seen = useRef<Map<string, BandQuestion> | null>(null);
  if (seen.current === null) {
    seen.current = new Map();
    for (const id of book.knownIds(projectId)) {
      const known = book.known(projectId, id);
      if (known && (openIds.has(id) || book.held(projectId, id) !== null))
        seen.current.set(id, known);
    }
  }
  for (const question of questions) seen.current.set(question.id, question);
  const order = [...seen.current.values()];

  const firstOpen = () =>
    order.find(
      (question) => openIds.has(question.id) && !isAnswered(book.held(projectId, question.id)),
    )?.id ?? REVIEW;
  const [currentId, setCurrentId] = useState<string>(() =>
    start.kind === 'question' ? start.questionId : start.kind === 'resume' ? firstOpen() : REVIEW,
  );
  const index = currentId === REVIEW ? order.length : order.findIndex((q) => q.id === currentId);
  const current = index >= 0 ? (order[index] ?? null) : null;
  const shownIndex = index < 0 ? order.length : index;

  const isOpen = current !== null && openIds.has(current.id);
  const detail = useQuestionDetail(
    read,
    projectId,
    current?.id ?? null,
    String(isOpen),
    (loaded) => {
      if (loaded.status !== 'open') book.markClosed(projectId, loaded.id, loaded.status);
    },
  );

  const closedOf = (question: BandQuestion) =>
    book.closedReason(projectId, question.id) ?? (openIds.has(question.id) ? null : 'gone');
  const steps: AnswerStep[] = order.map((question) => ({
    id: question.id,
    label: plainTitle(question.title),
    state:
      closedOf(question) !== null
        ? 'closed'
        : isAnswered(book.held(projectId, question.id))
          ? 'answered'
          : 'open',
  }));

  const sending = book.sending(projectId);
  const inRun = new Set(order.map((question) => question.id));
  const sendable = book.sendableIds(projectId).filter((id) => inRun.has(id));

  const goTo = (to: number) => setCurrentId(order[to]?.id ?? REVIEW);

  const describe = (error: unknown): string => {
    const conflicts = conflictsOf(error);
    if (conflicts && conflicts.answered.length + conflicts.withdrawn.length > 0)
      return t('questions.flow.conflict');
    if (error instanceof WriteError && error.code === 'page_out_of_date')
      return t('detail.pageOutOfDate');
    const problem = problemOf(error);
    if (problem === null) return t('detail.saveError');
    return problem.field === ''
      ? t('detail.problemNoField', { file: problem.file, reason: problem.reason })
      : t('detail.problem', { file: problem.file, field: problem.field, reason: problem.reason });
  };
  const send = () => {
    void book.send(projectId, write, describe).then((saved) => {
      if (saved) onSent();
    });
  };

  const refs = current ? (detail.detail?.referencedBy ?? current.referencedBy) : [];
  const firstTask = tasks.find((task) => task.id === refs[0]);
  const held = current ? book.held(projectId, current.id) : null;
  const closed = current ? closedOf(current) : null;
  const view: DecisionAnswerView = {
    choiceId: held?.choiceId ?? null,
    text: held?.text ?? '',
    phase: sending ? 'sending' : 'editing',
    notice: closed === null ? null : closed === 'answered' ? 'answered' : 'withdrawn',
    failure: null,
    tooLong: held !== null && !isWithinLimit(held),
    sendable: false,
    disabled: closed !== null || sending,
    hasInput: held !== null && (held.choiceId !== null || held.text !== ''),
  };

  const reviewItems: ReviewItem[] = order
    .filter((question) => closedOf(question) === null || book.held(projectId, question.id))
    .map((question) => {
      const answer = book.held(projectId, question.id);
      return {
        id: question.id,
        identity: taskRefs(question.referencedBy, t('questions.band.noTask')),
        title: plainTitle(question.title),
        state: closedOf(question) !== null ? 'closed' : isAnswered(answer) ? 'answered' : 'open',
        choiceLabel: answer?.choiceLabel ?? null,
        text: answer?.text ?? '',
        closedReason: closedOf(question),
      };
    });

  return {
    identity: current ? taskRefs(refs, t('questions.band.noTask')) : '',
    title: firstTask?.title ?? (current ? plainTitle(current.title) : ''),
    steps,
    current: shownIndex,
    answeredCount: sendable.length,
    panel:
      current === null || detail.detail === null
        ? null
        : {
            question: detail.detail.question,
            choices: detail.detail.choices,
            view,
            resolveAttachment:
              attachmentUrl && refs[0] !== undefined
                ? (id: string) => attachmentUrl(refs[0] as number, id)
                : undefined,
            onChoiceChange: (choiceId) =>
              book.setChoice(
                projectId,
                current.id,
                detail.detail?.choices.find((choice) => choice.id === choiceId) ?? null,
              ),
            onTextChange: (text) => book.setText(projectId, current.id, text),
            onClear: () => book.clear(projectId, current.id),
          },
    loading: detail.state === 'ready' ? null : detail.state,
    onReload: detail.reload,
    review: {
      items: reviewItems,
      onChange: (questionId) => setCurrentId(questionId),
      onDiscard: (questionId) => book.clear(projectId, questionId),
    },
    sending,
    failure: book.failure(projectId),
    canSend: sendable.length > 0,
    onPrev: () => goTo(Math.max(0, shownIndex - 1)),
    onNext: () => goTo(shownIndex + 1),
    onSend: send,
    goTo,
  };
}
