import { answerRequest } from '../../api';
import { DecisionRequestForm } from './DecisionRequestForm';
import type { OperationControls } from '../../lib/projectSession';
import type { Card, ProjectId } from '../../types';

/**
 * The decision request of a pending card: the question, the single choice, the free text and Send, in
 * that order. The form is open from the start, empty. A send is for the request the form was opened for;
 * when the pending request changes, the form moves to the latest request and the old choice is dropped.
 */
export function DecisionRequest({
  projectId,
  card,
  operations,
  onChanged,
  onAnswered,
}: {
  projectId: ProjectId;
  card: Card;
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
      card={card}
      operations={operations}
      writeAnswer={writeAnswer}
      onChanged={onChanged}
      onAnswered={() => onAnswered?.()}
    />
  );
}
