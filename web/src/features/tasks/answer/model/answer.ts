import type { Task, ProjectId } from '../../../../shared/api/contracts';

/** An answer to the request currently shown on a card. */
export interface AnswerInput {
  requestId: string;
  choiceId?: string;
  text?: string;
}

export interface AnswerResult {
  task: Task;
  changed: boolean;
}

/** The transport is injected so the shared form never depends on a PC or monitor API. */
export type AnswerWriter = (
  projectId: ProjectId,
  taskId: number,
  input: AnswerInput,
) => Promise<AnswerResult>;

export type AnswerFormPhase = 'editing' | 'sending' | 'failed';

export interface AnswerFormState {
  baseRequestId: string | null;
  choiceId: string | null;
  text: string;
  questionExpanded: boolean;
  phase: AnswerFormPhase;
  failure: string | null;
  requestChanged: boolean;
}

export type AnswerFormKey = `${ProjectId}:${number}:${string}`;

/** An optional external store keeps this card's draft when the form unmounts. */
export interface AnswerFormStateStore {
  getSnapshot: (key: AnswerFormKey) => AnswerFormState | null;
  subscribe: (key: AnswerFormKey, listener: () => void) => () => void;
  update: (key: AnswerFormKey, update: (state: AnswerFormState) => AnswerFormState) => void;
}
