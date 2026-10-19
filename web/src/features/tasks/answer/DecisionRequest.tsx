import { answerRequest } from '../api/edit';
import { DecisionRequestForm } from './DecisionRequestForm';
import type { OperationControls } from '../../../shared/lib/operations/operations';
import type { Task, ProjectId } from '../../../shared/api/contracts';

/**
 * The decision request of a pending card: the question, the single choice, the free text and Send, in
 * that order. The form is open from the start, empty. A send is for the request the form was opened for;
 * when the pending request changes, the form moves to the latest request and the old choice is dropped.
 */
export function DecisionRequest({
  projectId,
  task,
  operations,
  onChanged,
  onAnswered,
}: {
  projectId: ProjectId;
  task: Task;
  operations: OperationControls;
  /** An answer was saved (or found stale): the board should be fetched again. */
  onChanged?: () => void;
  /** An answer was saved. The panel tells the person that the work resumes. */
  onAnswered?: () => void;
}) {
  const writeAnswer = async (
    projectId: ProjectId,
    id: number,
    input: Parameters<typeof answerRequest>[2],
  ) => answerRequest(projectId, id, input);
  return (
    <DecisionRequestForm
      projectId={projectId}
      task={task}
      operations={operations}
      writeAnswer={writeAnswer}
      onChanged={onChanged}
      onAnswered={() => onAnswered?.()}
    />
  );
}
