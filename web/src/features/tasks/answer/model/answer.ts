import type { ProjectId, TaskSummary } from '../../../../shared/api/contracts';

/**
 * An answer to the question currently shown on a card. `requestId` holds the question's ID
 * (`Q-<n>`), which the card carries as its `pendingRequestId`.
 */
export interface AnswerInput {
  requestId: string;
  choiceId?: string;
  text?: string;
}

/** The card as it reads once its question is answered, until the next Summary arrives. */
export interface AnswerResult {
  task: TaskSummary;
  changed: boolean;
}

/**
 * The transport is injected so the shared form never depends on a PC or monitor API. It sends one
 * answer to `.../qa/answers`; what it resolves with is not read.
 */
export type AnswerWriter = (
  projectId: ProjectId,
  taskId: number,
  input: AnswerInput,
) => Promise<unknown>;

/** The body of `POST .../qa/answers` for one answer. */
export function answersBody(input: AnswerInput) {
  return {
    answers: [{ questionId: input.requestId, choiceId: input.choiceId, text: input.text }],
  };
}

/**
 * The answered card until the next Summary: it no longer waits on the question. When the task
 * still waits on another question, the Summary brings that question back.
 */
export function answeredTask<T extends TaskSummary>(task: T): T {
  return {
    ...task,
    agentStatus: 'idle',
    pendingRequestId: null,
    pendingReason: null,
    pendingChoices: [],
  };
}

/** A conflict that means the question shown is no longer open. */
export function isStaleAnswer(code: string | null | undefined, status: number): boolean {
  return code === 'question_answered' || code === 'question_withdrawn' || status === 404;
}

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
