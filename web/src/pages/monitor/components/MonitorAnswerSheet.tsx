import { type FormEvent, useEffect, useMemo, useRef } from 'react';
import { DecisionAnswerSheet } from '../../../features/tasks/answer/DecisionAnswerSheet';
import { useDecisionRequestForm } from '../../../features/tasks/answer/useDecisionRequestForm';
import type { ProjectId } from '../../../shared/api/contracts';
import type { MonitorAnswerController, MonitorReadResolvers, MonitorTask } from '../contracts';
import { attachmentResolver } from './attachment-resolver';

export interface MonitorAnswerSheetProps {
  /** Every task on the screen; the sheet follows its own among them. */
  items: readonly MonitorTask[];
  projectId: ProjectId;
  taskId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  controller: MonitorAnswerController;
  resolvers: MonitorReadResolvers;
}

const noEvent = { preventDefault: () => undefined } as FormEvent;

/**
 * The answer sheet of one task. It lives outside the cards, so a card that moves does not close it,
 * and it keeps the last task it saw when the task leaves the board. A `key` per task starts it afresh.
 */
export default function MonitorAnswerSheet({
  items,
  projectId,
  taskId,
  open,
  onOpenChange,
  controller,
  resolvers,
}: MonitorAnswerSheetProps) {
  const current = items.find((item) => item.projectId === projectId && item.task.id === taskId);
  const last = useRef(current);
  if (current) last.current = current;
  const item = current ?? last.current;

  const { setAnswerOpen } = controller;
  useEffect(() => {
    setAnswerOpen(projectId, taskId, open);
    return () => setAnswerOpen(projectId, taskId, false);
  }, [setAnswerOpen, projectId, taskId, open]);

  const resolveAttachment = useMemo(
    () => attachmentResolver((id) => resolvers.attachmentUrl(projectId, taskId, id)),
    [resolvers, projectId, taskId],
  );
  if (!item) return null;
  return (
    <SheetBody
      item={item}
      missing={current === undefined}
      open={open}
      onOpenChange={onOpenChange}
      controller={controller}
      resolveAttachment={resolveAttachment}
    />
  );
}

function SheetBody({
  item,
  missing,
  open,
  onOpenChange,
  controller,
  resolveAttachment,
}: {
  item: MonitorTask;
  missing: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  controller: MonitorAnswerController;
  resolveAttachment: (id: string) => string | null;
}) {
  const { projectId, task } = item;
  // A withdrawn question stays readable: the last one asked is kept.
  const asked = useRef({ question: task.pendingReason, choices: task.pendingChoices });
  if (task.pendingRequestId !== null) {
    asked.current = { question: task.pendingReason, choices: task.pendingChoices };
  }
  const form = useDecisionRequestForm({
    projectId,
    task,
    operations: controller.operationsFor(projectId, task.id, task.pendingRequestId),
    writeAnswer: controller.writeAnswer,
    disabled: controller.wasAnswered(projectId, task.id, task.pendingRequestId),
    missing,
    stateStore: controller.stateStore,
    onRequestStale: (requestId) => controller.markRequestStale(projectId, task.id, requestId),
    onAnswered: (result) => {
      if (task.pendingRequestId) controller.onAnswered(item, task.pendingRequestId, result);
      onOpenChange(false);
    },
  });
  const send = () => void form.submit(noEvent);
  return (
    <DecisionAnswerSheet
      open={open}
      onOpenChange={onOpenChange}
      identity={`#${task.id}`}
      title={task.title}
      question={asked.current.question}
      choices={asked.current.choices}
      view={form.model}
      resolveAttachment={resolveAttachment}
      onChoiceChange={form.updateChoice}
      onTextChange={form.updateText}
      onClear={form.clear}
      onSubmit={send}
      onRetry={send}
    />
  );
}
