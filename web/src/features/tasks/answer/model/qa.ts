import type { Choice, ProjectId } from '../../../../shared/api/contracts';

/** An open question as the band lists it: enough to show it, not its text or options. */
export interface BandQuestion {
  id: string;
  /** The first line of the question. */
  title: string;
  /** The cards that wait on the question; empty when no card refers to it. */
  referencedBy: number[];
}

export type QuestionStatus = 'open' | 'answered' | 'withdrawn';

/** One question as `GET .../messages/{questionId}` returns it: what the answer dialog shows. */
export interface QuestionDetail {
  id: string;
  question: string;
  choices: Choice[];
  recommendedChoiceId: string | null;
  status: QuestionStatus;
  referencedBy: number[];
}

/** Reads one question; the PC and the monitor each read it through their own routes. */
export type QuestionReader = (projectId: ProjectId, questionId: string) => Promise<QuestionDetail>;

/** One answer of `POST .../messages/answers`. */
export interface AnswerItem {
  questionId: string;
  choiceId?: string;
  text?: string;
}

/** Sends the answers together; the server writes all of them or none. */
export type AnswersWriter = (projectId: ProjectId, answers: AnswerItem[]) => Promise<unknown>;

/** An answer kept on the screen until it is sent. The label is kept for the review list. */
export interface HeldAnswer {
  choiceId: string | null;
  choiceLabel: string | null;
  text: string;
}

/** The note's limit, as the server checks it. */
export const MAX_ANSWER_TEXT = 2000;

export const isAnswered = (held: HeldAnswer | null | undefined): held is HeldAnswer =>
  held != null && (held.choiceId !== null || held.text.trim() !== '');

export const isWithinLimit = (held: HeldAnswer): boolean =>
  [...held.text].length <= MAX_ANSWER_TEXT;

/** The body of `POST .../messages/answers`. */
export function answersBody(answers: readonly AnswerItem[]) {
  return { answers };
}

/** The question's first line without the Markdown marks that start a heading, a quote or a list. */
export function plainTitle(title: string): string {
  return title
    .replace(/^\s*(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/, '')
    .replace(/\*\*|__|`/g, '')
    .trim();
}

/** The open question that a card shows first: the first of its open questions in the band. */
export function firstQuestionOf(
  questions: readonly BandQuestion[],
  taskId: number,
): BandQuestion | null {
  return questions.find((question) => question.referencedBy.includes(taskId)) ?? null;
}

/** Parses a question as the routes return it; anything else is treated as missing. */
export function parseQuestionDetail(value: unknown): QuestionDetail {
  const body = (value as { question?: Record<string, unknown> } | null)?.question;
  if (!body || typeof body.id !== 'string' || typeof body.body !== 'string')
    throw new TypeError('The question response is not valid.');
  const status = body.status;
  return {
    id: body.id,
    question: body.body,
    choices: Array.isArray(body.choices)
      ? (body.choices as Choice[]).filter(
          (choice) => typeof choice?.id === 'string' && typeof choice.label === 'string',
        )
      : [],
    recommendedChoiceId:
      typeof body.recommendedChoiceId === 'string' ? body.recommendedChoiceId : null,
    status: status === 'answered' || status === 'withdrawn' ? status : 'open',
    referencedBy: Array.isArray(body.referencedBy)
      ? (body.referencedBy as unknown[]).filter((id): id is number => typeof id === 'number')
      : [],
  };
}
