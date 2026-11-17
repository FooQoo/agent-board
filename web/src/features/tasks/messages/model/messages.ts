import type { Choice, ProjectId } from '@/shared/api/contracts';
import type { Message } from '@/shared/data/api/contracts';

/** The two tabs of the list: what the AI asks you, and what you asked the AI. */
export type MessageTab = 'fromAi' | 'fromYou';

/** Which tab a listed message belongs to. A message that is over is not listed at all. */
export function tabOf(message: Message): MessageTab | null {
  if (message.turn === null) return null;
  return message.from === 'ai' ? 'fromAi' : 'fromYou';
}

export interface MessageCount {
  /** Questions and approvals waiting for you. An answer the AI has not taken in is not counted. */
  fromAi: number;
  questions: number;
  approvals: number;
  /** Your requests that no agent has picked up yet. */
  fromYou: number;
}

/** What the band says: how many messages wait on you, and how many of yours wait to be picked up. */
export function countMessages(messages: readonly Message[]): MessageCount {
  const count: MessageCount = { fromAi: 0, questions: 0, approvals: 0, fromYou: 0 };
  for (const message of messages) {
    const tab = tabOf(message);
    if (tab === 'fromAi') {
      if (message.turn !== 'human') continue;
      count.fromAi += 1;
      if (message.type === 'approval') count.approvals += 1;
      else count.questions += 1;
    } else if (tab === 'fromYou') count.fromYou += 1;
  }
  return count;
}

/** The first open question that the card waits on, so the card's button opens the list at it. */
export function firstQuestionOfTask(messages: readonly Message[], taskId: number): Message | null {
  return (
    messages.find(
      (message) =>
        message.type === 'question' && message.turn === 'human' && message.tasks.includes(taskId),
    ) ?? null
  );
}

/** The question's first line without the Markdown marks that start a heading, a quote or a list. */
export function plainTitle(title: string): string {
  return title
    .replace(/^\s*(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/, '')
    .replace(/\*\*|__|`/g, '')
    .trim();
}

/** The note's limit, as the server checks it. */
export const MAX_ANSWER_TEXT = 2000;

/**
 * Whether an answer can be sent. The server refuses a question with choices that gets text only
 * (422), so a choice is required there and the note is optional; a question without choices needs
 * the note.
 */
export function canSendAnswer(
  choices: readonly Choice[],
  choiceId: string | null,
  text: string,
): boolean {
  if ([...text].length > MAX_ANSWER_TEXT) return false;
  return choices.length > 0 ? choiceId !== null : text.trim() !== '';
}

export type MessageStatus = 'open' | 'answered' | 'accepted' | 'withdrawn';

/** The answer of a question, as the opened question shows it once it is sent. */
export interface MessageReply {
  choiceLabel: string | null;
  text: string | null;
  /** When an AI took the answer in; null until then. */
  acceptedAt: string | null;
}

/** One message as `GET .../messages/{id}` returns it: what the opened row shows. */
export interface MessageDetail {
  id: string;
  type: 'question' | 'request';
  body: string;
  choices: Choice[];
  recommendedChoiceId: string | null;
  status: MessageStatus;
  /** The cards that wait on a question. */
  referencedBy: number[];
  /** The answer of an answered question; absent or null otherwise. */
  reply?: MessageReply | null;
}

function replyOf(value: unknown): MessageReply | null {
  if (typeof value !== 'object' || value === null) return null;
  const reply = value as Record<string, unknown>;
  const text = (key: string) => (typeof reply[key] === 'string' ? (reply[key] as string) : null);
  return { choiceLabel: text('choiceLabel'), text: text('text'), acceptedAt: text('acceptedAt') };
}

/** Parses a message as the route returns it: `{question}` or `{request}`. */
export function parseMessageDetail(value: unknown): MessageDetail {
  const wire = value as { question?: Record<string, unknown>; request?: Record<string, unknown> };
  const body = wire?.question ?? wire?.request;
  if (!body || typeof body.id !== 'string' || typeof body.body !== 'string')
    throw new TypeError('The message response is not valid.');
  const status = body.status;
  return {
    id: body.id,
    type: wire.question ? 'question' : 'request',
    body: body.body,
    choices: Array.isArray(body.choices)
      ? (body.choices as Choice[]).filter(
          (choice) => typeof choice?.id === 'string' && typeof choice.label === 'string',
        )
      : [],
    recommendedChoiceId:
      typeof body.recommendedChoiceId === 'string' ? body.recommendedChoiceId : null,
    status:
      status === 'answered' || status === 'accepted' || status === 'withdrawn' ? status : 'open',
    referencedBy: Array.isArray(body.referencedBy)
      ? (body.referencedBy as unknown[]).filter((id): id is number => typeof id === 'number')
      : [],
    reply: replyOf(body.reply),
  };
}

/** One answer of `POST .../messages/answers`. */
export interface AnswerItem {
  questionId: string;
  choiceId?: string;
  text?: string;
}

/** The routes the list needs; the board and the monitor each give their own. */
export interface MessagesApi {
  read: (projectId: ProjectId, messageId: string) => Promise<MessageDetail>;
  answer: (projectId: ProjectId, answers: AnswerItem[]) => Promise<unknown>;
  withdraw: (projectId: ProjectId, messageId: string) => Promise<unknown>;
}
