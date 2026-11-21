import type { Choice, ProjectId } from '@/shared/api/contracts';
import type { Message } from '@/shared/data/api/contracts';
import type { EditorAttachment } from '@/shared/ui/editor/attachmentTypes';

/** The two tabs of messages: what the AI asks you, and what you asked the AI. */
export type MessageKindTab = 'fromAi' | 'fromYou';

/** The tabs of the list: the two kinds of messages, and the periodic summaries. */
export type MessageTab = MessageKindTab | 'summary';

/** Which tab a listed message belongs to. A message that is over is not listed at all. */
export function tabOf(message: Message): MessageKindTab | null {
  if (message.turn === null) return null;
  return message.from === 'ai' ? 'fromAi' : 'fromYou';
}

export interface MessageCount {
  /** Questions waiting for you. An answer the AI has not taken in is not counted. */
  fromAi: number;
  /** Your requests that no agent has picked up yet. */
  fromYou: number;
}

/** What the band says: how many messages wait on you, and how many of yours wait to be picked up. */
export function countMessages(messages: readonly Message[]): MessageCount {
  const count: MessageCount = { fromAi: 0, fromYou: 0 };
  for (const message of messages) {
    const tab = tabOf(message);
    if (tab === 'fromAi') {
      if (message.turn !== 'human') continue;
      count.fromAi += 1;
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
 * Whether an answer can be sent: a choice, a note, or both. A question without choices needs the
 * note, because there is nothing to choose.
 */
export function canSendAnswer(
  choices: readonly Choice[],
  choiceId: string | null,
  text: string,
): boolean {
  if ([...text].length > MAX_ANSWER_TEXT) return false;
  const hasNote = text.trim() !== '';
  return choices.length > 0 ? choiceId !== null || hasNote : hasNote;
}

export type MessageStatus = 'open' | 'answered' | 'accepted' | 'withdrawn';

/** The answer of a question, as the opened question shows it once it is sent. */
export interface MessageReply {
  choiceLabel: string | null;
  text: string | null;
  /** The names of the images attached to the answer, stored with the question as `attachments/<name>`. */
  images: string[];
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
  const images = Array.isArray(reply.images)
    ? (reply.images as unknown[]).filter((name): name is string => typeof name === 'string')
    : [];
  return {
    choiceLabel: text('choiceLabel'),
    text: text('text'),
    images,
    acceptedAt: text('acceptedAt'),
  };
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

/** One result line of a periodic summary. */
export interface SummaryResult {
  taskId: number;
  /** The version of the result in the task's results; null for a line written before it was recorded. */
  version: number | null;
  title: string;
}

/** One periodic summary, as `GET .../summaries` lists it. Dismissed ones are not listed. */
export interface PeriodicSummary {
  id: string;
  /** The window, UTC RFC 3339. */
  from: string;
  to: string;
  results: SummaryResult[];
}

/** Parses `GET .../summaries`: `{summaries: [...]}`; an entry that is not well formed is left out. */
export function parseSummaries(value: unknown): PeriodicSummary[] {
  const list = (value as { summaries?: unknown } | null)?.summaries;
  if (!Array.isArray(list)) throw new TypeError('The summaries response is not valid.');
  const out: PeriodicSummary[] = [];
  for (const entry of list as Record<string, unknown>[]) {
    if (
      typeof entry?.id !== 'string' ||
      typeof entry.from !== 'string' ||
      typeof entry.to !== 'string' ||
      !Array.isArray(entry.results)
    )
      continue;
    if (entry.dismissed === true) continue;
    out.push({
      id: entry.id,
      from: entry.from,
      to: entry.to,
      results: (entry.results as Record<string, unknown>[])
        .filter((r) => typeof r?.taskId === 'number' && typeof r.title === 'string')
        .map((r) => ({
          taskId: r.taskId as number,
          version:
            typeof r.version === 'number' && Number.isSafeInteger(r.version) && r.version > 0
              ? r.version
              : null,
          title: r.title as string,
        })),
    });
  }
  return out;
}

const pad = (n: number) => String(n).padStart(2, '0');
const dayOf = (d: Date) => `${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
const clockOf = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/**
 * The window as a person reads it, in local time: `11/20 09:00–10:00`. A window that ends on
 * another day names that day too: `11/20 23:30–11/21 00:00`. A time that cannot be read is shown
 * as it was written.
 */
export function windowLabel(from: string, to: string): string {
  const start = new Date(from);
  const end = new Date(to);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return `${from}–${to}`;
  const endText = dayOf(start) === dayOf(end) ? clockOf(end) : `${dayOf(end)} ${clockOf(end)}`;
  return `${dayOf(start)} ${clockOf(start)}–${endText}`;
}

/** The routes of the Summary tab. A screen without them shows no such tab. */
export interface SummariesApi {
  list: (projectId: ProjectId) => Promise<PeriodicSummary[]>;
  /** Sets the summary aside; the record stays on disk. Safe to repeat. */
  dismiss: (projectId: ProjectId, summaryId: string) => Promise<unknown>;
}

/** The routes the list needs; the board and the monitor each give their own. */
export interface MessagesApi {
  /** The periodic summaries; without it the list has no Summary tab. */
  summaries?: SummariesApi;
  read: (projectId: ProjectId, messageId: string) => Promise<MessageDetail>;
  /** `attachments` are the images added to the answer; they are sent with the one question answered. */
  answer: (
    projectId: ProjectId,
    answers: AnswerItem[],
    attachments?: readonly EditorAttachment[],
  ) => Promise<unknown>;
  withdraw: (projectId: ProjectId, messageId: string) => Promise<unknown>;
}
