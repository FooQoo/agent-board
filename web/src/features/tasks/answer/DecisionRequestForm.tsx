import type { AnswerResult, AnswerWriter, AnswerFormStateStore } from './model/answer';
import { DecisionRequestFormView } from './DecisionRequestFormView';
import { useDecisionRequestForm } from './useDecisionRequestForm';
import type { OperationControls } from '../../../shared/lib/operations/operations';
import type { Task, ProjectId } from '../../../shared/api/contracts';
import './decision-request.css';

/** Shared answer form for the local board and the isolated mobile monitor. */
export function DecisionRequestForm({
  projectId,
  task,
  operations,
  writeAnswer,
  disabled = false,
  stateStore,
  onChanged,
  onAnswered,
  onRequestStale,
}: {
  projectId: ProjectId;
  task: Task;
  operations: OperationControls;
  writeAnswer: AnswerWriter;
  disabled?: boolean;
  stateStore?: AnswerFormStateStore;
  onChanged?: () => void;
  onAnswered?: (result: AnswerResult) => void;
  onRequestStale?: (requestId: string) => void;
}) {
  const form = useDecisionRequestForm({
    projectId,
    task,
    operations,
    writeAnswer,
    disabled,
    stateStore,
    onChanged,
    onAnswered,
    onRequestStale,
  });

  return (
    <DecisionRequestFormView
      question={task.pendingReason}
      choices={task.pendingChoices}
      model={form.model}
      onChoiceChange={form.updateChoice}
      onTextChange={form.updateText}
      onExpandQuestion={form.expandQuestion}
      onClear={form.clear}
      onSubmit={form.submit}
    />
  );
}
