import type { BandQuestion } from './model/qa';

/**
 * Where a run through the questions starts. There are two kinds of run, and the mode says which.
 *
 * - `direct`: only the asked questions, with no review. Send, on the last of them, sends at once.
 *   A band item opens one question; a card opens the questions of its task.
 * - `batch`: every open question, with the review step and Send all. The band header's Answer them
 *   and Continue answering start at the first question with no answer held (`resume`); Review and
 *   send starts at the review (`review`).
 *
 * Build one with `answerStart`, so that a call site names the mode it opens.
 */
export type AnswerStart =
  | {
      mode: 'direct';
      scope: { kind: 'question'; questionId: string } | { kind: 'task'; taskId: number };
    }
  | { mode: 'batch'; at: 'resume' | 'review' };

export const answerStart = {
  /** Only this question, from an item of the band. */
  question: (questionId: string): AnswerStart => ({
    mode: 'direct',
    scope: { kind: 'question', questionId },
  }),
  /** Only the questions of this task, from its card. */
  task: (taskId: number): AnswerStart => ({ mode: 'direct', scope: { kind: 'task', taskId } }),
  /** Every open question, from the first one with no answer held. */
  resume: (): AnswerStart => ({ mode: 'batch', at: 'resume' }),
  /** Every open question, from the review. */
  review: (): AnswerStart => ({ mode: 'batch', at: 'review' }),
};

/**
 * Where a run opens, once its questions are known: at one question, at the first open question with
 * no answer held (the first of a direct run, the review of a batch run when there is none), or at
 * the review.
 */
export type RunOpening = { questionId: string } | 'firstOpen' | 'review';

/** What a run holds and how it opens and ends, worked out from its start in one place. */
export interface RunPlan {
  /** True when the run has no review: Send on its last question sends at once. */
  direct: boolean;
  /** Whether a question belongs to the run. */
  includes: (question: BandQuestion) => boolean;
  opening: RunOpening;
}

/** Fails to compile when a case of the switch above is missing. */
const never = (value: never): never => value;

export function runPlan(start: AnswerStart): RunPlan {
  switch (start.mode) {
    case 'direct': {
      const { scope } = start;
      switch (scope.kind) {
        case 'question':
          return {
            direct: true,
            includes: (question) => question.id === scope.questionId,
            opening: { questionId: scope.questionId },
          };
        case 'task':
          return {
            direct: true,
            includes: (question) => question.referencedBy.includes(scope.taskId),
            opening: 'firstOpen',
          };
        default:
          return never(scope);
      }
    }
    case 'batch':
      switch (start.at) {
        case 'resume':
          return {
            direct: false,
            includes: () => true,
            opening: 'firstOpen',
          };
        case 'review':
          return { direct: false, includes: () => true, opening: 'review' };
        default:
          return never(start.at);
      }
    default:
      return never(start);
  }
}
