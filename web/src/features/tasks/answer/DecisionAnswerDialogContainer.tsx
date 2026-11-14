import type { ProjectId } from '@/shared/api/contracts';
import { DecisionAnswerDialog } from './DecisionAnswerDialog';
import type { AnswerBook } from './model/answerBook';
import type { AnswersWriter, BandQuestion, QuestionReader } from './model/qa';
import { type AnswerStart, useAnswerFlow } from './useAnswerFlow';

export interface DecisionAnswerDialogContainerProps {
  projectId: ProjectId;
  /** The open questions of the project, from its Summary. */
  questions: readonly BandQuestion[];
  /** The cards, for the title of a question's first card. */
  tasks: readonly { id: number; title: string }[];
  book: AnswerBook;
  start: AnswerStart;
  read: QuestionReader;
  write: AnswersWriter;
  /** The answers were saved; the board is read again at once. */
  onSent: () => void;
  onClose: () => void;
}

/**
 * The answer dialog wired to the board: it runs through the project's open questions from where it
 * was opened, keeps each answer in the page's book, and sends them together from the review.
 */
export function DecisionAnswerDialogContainer({
  projectId,
  questions,
  tasks,
  book,
  start,
  read,
  write,
  onSent,
  onClose,
}: DecisionAnswerDialogContainerProps) {
  const { goTo, ...flow } = useAnswerFlow({
    projectId,
    questions,
    tasks,
    book,
    start,
    read,
    write,
    attachmentUrl: (taskId, id) => `/api/projects/${projectId}/tasks/${taskId}/attachments/${id}`,
    onSent: () => {
      onSent();
      onClose();
    },
  });
  return (
    <DecisionAnswerDialog
      {...flow}
      onStep={goTo}
      returnFocusSelector=".question-band__actions button:last-child"
      onClose={onClose}
    />
  );
}
