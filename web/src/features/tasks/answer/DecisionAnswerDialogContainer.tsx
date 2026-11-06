import { useCallback, useEffect, useRef } from 'react';
import type { FormEvent } from 'react';
import type { OperationControls } from '@/shared/lib/operations/operations';
import type { ProjectId, TaskSummary } from '@/shared/api/contracts';
import { DecisionAnswerDialog } from './DecisionAnswerDialog';
import { useDecisionRequestForm } from './useDecisionRequestForm';
import type { TaskAnswerController } from './model/useTaskAnswers';

export interface DecisionAnswerDialogContainerProps {
  projectId: ProjectId;
  /** The card's number; the dialog keeps its last question when the card leaves the board. */
  taskId: number;
  /** The card as the board lists it now; null once it is gone. */
  task: TaskSummary | null;
  answers: TaskAnswerController;
  operations: OperationControls;
  syncedAt: Date | null;
  onAnswerChanged?: () => void;
  onClose: () => void;
}

const submitEvent = { preventDefault: () => {} } as FormEvent;

/**
 * The answer dialog wired to the board: the card's form state, the open/closed lease, and the
 * attachment URLs of the question. It keeps the last known card, so a withdrawn question stays
 * readable.
 */
export function DecisionAnswerDialogContainer({
  projectId,
  taskId,
  task,
  answers,
  operations,
  syncedAt,
  onAnswerChanged,
  onClose,
}: DecisionAnswerDialogContainerProps) {
  // The card keeps its last known state, and the last card that still had a request keeps the question:
  // a withdrawn request clears the question on the board, but the dialog goes on showing it.
  const lastTask = useRef<TaskSummary | null>(task);
  const lastAsked = useRef<TaskSummary | null>(task?.pendingRequestId != null ? task : null);
  if (task !== null) lastTask.current = task;
  if (task?.pendingRequestId != null) lastAsked.current = task;
  const shown = lastTask.current;
  const asked = lastAsked.current ?? shown;
  const { setAnswerOpen } = answers;
  useEffect(() => {
    setAnswerOpen(projectId, taskId, true);
    return () => setAnswerOpen(projectId, taskId, false);
  }, [projectId, taskId, setAnswerOpen]);
  if (shown === null) return null;
  return (
    <Connected
      projectId={projectId}
      task={shown}
      asked={asked}
      missing={task === null}
      answers={answers}
      operations={operations}
      syncedAt={syncedAt}
      onAnswerChanged={onAnswerChanged}
      onClose={onClose}
    />
  );
}

function Connected({
  projectId,
  task,
  asked,
  missing,
  answers,
  operations,
  syncedAt,
  onAnswerChanged,
  onClose,
}: Omit<DecisionAnswerDialogContainerProps, 'taskId' | 'task'> & {
  task: TaskSummary;
  /** The card as it last asked; its question and options are the ones shown. */
  asked: TaskSummary | null;
  missing: boolean;
}) {
  const requestId = task.pendingRequestId;
  const form = useDecisionRequestForm({
    projectId,
    task,
    operations,
    writeAnswer: answers.writeAnswer,
    disabled: answers.wasAnswered(projectId, task.id, requestId),
    missing,
    stateStore: answers.stateStore,
    onChanged: onAnswerChanged,
    onAnswered: (result) => {
      if (requestId) answers.onAnswered(projectId, task.id, requestId, result, syncedAt);
      onClose();
    },
  });
  const submit = useCallback(() => void form.submit(submitEvent), [form]);
  const resolveAttachment = useCallback(
    (id: string) => `/api/projects/${projectId}/tasks/${task.id}/attachments/${id}`,
    [projectId, task.id],
  );
  return (
    <DecisionAnswerDialog
      taskId={task.id}
      title={task.title}
      question={(asked ?? task).pendingReason}
      choices={(asked ?? task).pendingChoices}
      view={form.model}
      resolveAttachment={resolveAttachment}
      onChoiceChange={form.updateChoice}
      onTextChange={form.updateText}
      onClear={form.clear}
      onSubmit={submit}
      onRetry={submit}
      onClose={onClose}
    />
  );
}
