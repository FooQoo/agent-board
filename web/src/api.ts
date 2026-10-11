import type {
  ApiError,
  Assignee,
  Board,
  Card,
  ColumnName,
  Epic,
  EpicRef,
  Problem,
  ProjectId,
  ProjectList,
} from './types';
import type { EditorAttachment } from './components/editor/attachmentTypes';

const TOKEN_META = 'skan-token';

/** The server puts the session token for writes into `<meta name="skan-token">`. */
export function readToken(): string {
  const meta = document.querySelector<HTMLMetaElement>(`meta[name="${TOKEN_META}"]`);
  return meta?.content ?? '';
}

/** A failed read. `status` is 0 when the request never got an answer. */
export class FetchError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
  ) {
    super(message);
  }

  /** The project does not exist (it was deleted, or the URL names an unknown ID). */
  get projectNotFound(): boolean {
    return this.status === 404 && this.code === 'project_not_found';
  }
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!response.ok) {
    let code: string | null = null;
    try {
      code = ((await response.json()) as Partial<ApiError>).error?.code ?? null;
    } catch {
      // The body was not JSON.
    }
    throw new FetchError(
      `GET ${path} failed with status ${response.status}`,
      response.status,
      code,
    );
  }
  return (await response.json()) as T;
}

/** A card as the server writes it: the epic is an ID that the board resolves against `epics`. */
type WireCard = Omit<Card, 'epic'> & { epicId: string | null };

/** The board as the server writes it. The snapshot joins each card with its epic. */
interface WireBoard {
  project: Board['project'];
  version: string;
  cursor: string;
  epics: Epic[];
  cards: WireCard[];
  problems: Problem[];
}

function toCard(wire: WireCard, epics: readonly Epic[]): Card {
  const { epicId, ...rest } = wire;
  const found = epicId === null ? undefined : epics.find((e) => e.id === epicId);
  const epic: EpicRef | null = found
    ? { id: found.id, name: found.name, color: found.color }
    : null;
  return { ...rest, epic };
}

/** Turns a server board into the snapshot the screens use. An epic missing from `epics` leaves the card unlabeled. */
export function toBoard(wire: WireBoard): Board {
  return {
    project: wire.project,
    version: wire.version,
    cursor: wire.cursor,
    epics: wire.epics,
    cards: wire.cards.map((card) => toCard(card, wire.epics)),
    problems: wire.problems,
  };
}

function projectPath(projectId: ProjectId): string {
  return `/api/projects/${encodeURIComponent(projectId)}`;
}

export function fetchProjects(): Promise<ProjectList> {
  return getJson<ProjectList>('/api/projects');
}

export async function fetchBoard(projectId: ProjectId): Promise<Board> {
  return toBoard(await getJson<WireBoard>(`${projectPath(projectId)}/board`));
}

export interface ArchiveResponse {
  project: Board['project'];
  version: string;
  cursor: string;
  /** The archive response has no epic table, so an archived card carries no epic label. */
  cards: Card[];
}

export async function fetchArchive(projectId: ProjectId): Promise<ArchiveResponse> {
  const wire = await getJson<Omit<ArchiveResponse, 'cards'> & { cards: WireCard[] }>(
    `${projectPath(projectId)}/archive`,
  );
  return { ...wire, cards: wire.cards.map((card) => toCard(card, [])) };
}

async function postEmpty(path: string): Promise<{ card: Card }> {
  const response = await fetch(path, { method: 'POST', headers: { 'X-Skan-Token': readToken() } });
  const body = (await response.json()) as { card?: Card; error?: ApiError['error'] };
  if (!response.ok || !body.card)
    throw new WriteError(
      body.error?.reason ?? `Request failed (${response.status})`,
      response.status,
      body.error?.code ?? null,
      body.error?.message ?? null,
    );
  return { card: body.card };
}

export function archiveCard(projectId: ProjectId, id: number) {
  return postEmpty(`${projectPath(projectId)}/cards/${id}/archive`);
}

export function restoreCard(projectId: ProjectId, id: number) {
  return postEmpty(`${projectPath(projectId)}/cards/${id}/restore`);
}

export async function archiveDone(projectId: ProjectId, ids: readonly number[]) {
  return postCard<{ cards: Card[]; archivedCount: number }>(
    `${projectPath(projectId)}/cards/archive-done`,
    { ids },
  );
}

/**
 * - `deleted`: the server answered 204.
 * - `not_found`: the card is already gone (404).
 * - `failed`: anything else, including network errors.
 */
export type DeleteResult = 'deleted' | 'not_found' | 'failed';

export async function deleteCard(projectId: ProjectId, id: number): Promise<DeleteResult> {
  try {
    const response = await fetch(`${projectPath(projectId)}/cards/${id}`, {
      method: 'DELETE',
      headers: { 'X-Skan-Token': readToken() },
    });
    if (response.status === 204) return 'deleted';
    if (response.status === 404) return 'not_found';
    return 'failed';
  } catch {
    return 'failed';
  }
}

/**
 * A rejected write. `code` is the API error code (for example `request_changed`), when the body has one.
 * `detail` is the English message of the body (for `file_invalid`, it names the file).
 */
export class WriteError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
    readonly detail: string | null = null,
  ) {
    super(message);
  }
}

/**
 * The file, item and reason of a `file_invalid` answer, or null for other errors.
 * The server sends `message` as "<file> is not valid." and `reason` as "<field>: <reason>" (or the reason alone).
 */
export function problemOf(error: unknown): Problem | null {
  if (!(error instanceof WriteError) || error.code !== 'file_invalid') return null;
  const file = (error.detail ?? '').replace(/ is not valid\.$/, '');
  const reason = error.message;
  const separator = reason.indexOf(': ');
  if (separator === -1) return { file, field: '', reason };
  return { file, field: reason.slice(0, separator), reason: reason.slice(separator + 2) };
}

async function postCard<T>(path: string, value: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Skan-Token': readToken() },
    body: JSON.stringify(value),
  });
  const body = (await response.json()) as {
    card?: Card;
    changed?: boolean;
    error?: ApiError['error'];
  };
  if (!response.ok) {
    throw new WriteError(
      body.error?.reason ?? `Request failed (${response.status})`,
      response.status,
      body.error?.code ?? null,
      body.error?.message ?? null,
    );
  }
  return body as T;
}

export async function createCard(
  projectId: ProjectId,
  input: { title: string; description: string; assignee: Assignee; isDraft?: boolean },
) {
  return postCard<{ card: Card }>(`${projectPath(projectId)}/cards`, {
    ...input,
    isDraft: input.isDraft ?? false,
  });
}

function multipartBody(
  meta: Record<string, unknown>,
  attachments: readonly EditorAttachment[],
  removed: readonly string[] = [],
) {
  const form = new FormData();
  const additions = attachments.filter((a) => a.source === 'local');
  form.append(
    'metadata',
    JSON.stringify({
      ...meta,
      removeAttachmentIds: removed,
      attachments: additions.map((a) => ({ id: a.id, name: a.name })),
    }),
  );
  for (const attachment of attachments)
    if (attachment.source === 'local' && attachment.file)
      form.append('file', attachment.file, attachment.name);
  return form;
}

async function sendMultipart(path: string, body: FormData, method: 'POST' | 'PATCH') {
  const response = await fetch(path, { method, headers: { 'X-Skan-Token': readToken() }, body });
  const data = (await response.json()) as { card?: Card; error?: ApiError['error'] };
  if (!response.ok || !data.card)
    throw new WriteError(
      data.error?.reason ?? `Request failed (${response.status})`,
      response.status,
      data.error?.code ?? null,
      data.error?.message ?? null,
    );
  return { card: data.card };
}

export function createCardMultipart(
  projectId: ProjectId,
  input: {
    title: string;
    description: string;
    assignee: Assignee;
    isDraft?: boolean;
    requestId?: string;
    attachments: readonly EditorAttachment[];
  },
) {
  return sendMultipart(
    `${projectPath(projectId)}/cards/multipart`,
    multipartBody(
      { ...input, requestId: input.requestId ?? crypto.randomUUID(), attachments: undefined },
      input.attachments,
    ),
    'POST',
  );
}

/**
 * Adds a card in one request: with its images when there are some (multipart), and as a draft when
 * `isDraft` is set. A refused request is not repeated here, so a failure never adds two cards.
 */
export async function createNewCard(
  projectId: ProjectId,
  input: {
    title: string;
    description: string;
    assignee: Assignee;
    isDraft?: boolean;
    requestId?: string;
    attachments?: readonly EditorAttachment[];
  },
) {
  const isDraft = input.isDraft ?? false;
  if (input.attachments?.length)
    return createCardMultipart(projectId, {
      title: input.title,
      description: input.description,
      assignee: input.assignee,
      isDraft,
      requestId: input.requestId,
      attachments: input.attachments,
    });
  return createCard(projectId, {
    title: input.title,
    description: input.description,
    assignee: input.assignee,
    isDraft,
  });
}

export async function moveCard(
  projectId: ProjectId,
  id: number,
  cardStatus: ColumnName,
  reason: string,
) {
  return postCard<{ card: Card; changed: boolean }>(`${projectPath(projectId)}/cards/${id}/move`, {
    cardStatus,
    reason,
  });
}

/** An answer to the request `requestId`. Either a choice, a text, or both; a blank answer is refused by the server. */
export interface AnswerInput {
  requestId: string;
  choiceId?: string;
  text?: string;
}

export async function answerRequest(projectId: ProjectId, id: number, input: AnswerInput) {
  return postCard<{ card: Card; changed: boolean }>(
    `${projectPath(projectId)}/cards/${id}/answer`,
    input,
  );
}

/** Sends a write that answers `{card}` or an error body (PATCH and PUT). */
async function sendCard(
  method: 'PATCH' | 'PUT',
  path: string,
  value: unknown,
): Promise<{ card: Card }> {
  const response = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Skan-Token': readToken() },
    body: JSON.stringify(value),
  });
  const body = (await response.json()) as { card?: Card; error?: ApiError['error'] };
  if (!response.ok || body.card === undefined) {
    throw new WriteError(
      body.error?.reason ?? `Request failed (${response.status})`,
      response.status,
      body.error?.code ?? null,
      body.error?.message ?? null,
    );
  }
  return { card: body.card };
}

/**
 * Saves the title and/or description of a draft. `finalize` also hands the card back to the agents
 * in the same step. The server refuses a card that is not a draft.
 */
export async function editCard(
  projectId: ProjectId,
  id: number,
  input: { title?: string; description?: string; finalize?: boolean },
) {
  return sendCard('PATCH', `${projectPath(projectId)}/cards/${id}`, input);
}

export function editCardMultipart(
  projectId: ProjectId,
  id: number,
  input: {
    title?: string;
    description?: string;
    finalize?: boolean;
    requestId?: string;
    attachments: readonly EditorAttachment[];
    removedAttachmentIds?: readonly string[];
  },
) {
  const { attachments, removedAttachmentIds = [], ...meta } = input;
  return sendMultipart(
    `${projectPath(projectId)}/cards/${id}/multipart`,
    multipartBody(
      { ...meta, requestId: input.requestId ?? crypto.randomUUID() },
      attachments,
      removedAttachmentIds,
    ),
    'PATCH',
  );
}

/** Makes a card a draft (`true`) or finalizes it (`false`). Only an idle card can become a draft. */
export async function setDraft(projectId: ProjectId, id: number, isDraft: boolean) {
  return sendCard('PUT', `${projectPath(projectId)}/cards/${id}/draft`, { isDraft });
}

/** Sends a request whose answer is `{epic}` or an error body. */
async function sendEpic(
  method: 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: FormData | Record<string, unknown>,
): Promise<{ epic: Epic }> {
  const isForm = body instanceof FormData;
  const response = await fetch(path, {
    method,
    headers: {
      ...(isForm || body === undefined ? {} : { 'Content-Type': 'application/json' }),
      'X-Skan-Token': readToken(),
    },
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  });
  const data = (await response.json()) as { epic?: Epic; error?: ApiError['error'] };
  if (!response.ok || data.epic === undefined)
    throw new WriteError(
      data.error?.reason ?? `Request failed (${response.status})`,
      response.status,
      data.error?.code ?? null,
      data.error?.message ?? null,
    );
  return { epic: data.epic };
}

/** The name, color, draft flag or plan of an epic. Only the given fields change. */
export function updateEpic(
  projectId: ProjectId,
  epicId: string,
  input: { name?: string; color?: string; isDraft?: boolean; plan?: string },
) {
  return sendEpic('PATCH', `${projectPath(projectId)}/epics/${encodeURIComponent(epicId)}`, input);
}

/** Puts a card into the epic (`epicId`) or takes it out (`null`). */
export function setCardEpic(projectId: ProjectId, id: number, epicId: string | null) {
  return sendCard('PUT', `${projectPath(projectId)}/cards/${id}/epic`, { epicId });
}

/** Adds images to an epic. The IDs of the images are the ones the screen made, so a retry is the same write. */
export function addEpicAttachments(
  projectId: ProjectId,
  epicId: string,
  attachments: readonly EditorAttachment[],
  requestId: string,
) {
  const form = new FormData();
  form.append(
    'metadata',
    JSON.stringify({
      requestId,
      attachments: attachments.map((a) => ({ id: a.id, name: a.name })),
    }),
  );
  for (const attachment of attachments)
    if (attachment.file) form.append('file', attachment.file, attachment.name);
  return sendEpic(
    'POST',
    `${projectPath(projectId)}/epics/${encodeURIComponent(epicId)}/attachments`,
    form,
  );
}

/** Removes one image from an epic. */
export function deleteEpicAttachment(projectId: ProjectId, epicId: string, attachmentId: string) {
  return sendEpic(
    'DELETE',
    `${projectPath(projectId)}/epics/${encodeURIComponent(epicId)}/attachments/${encodeURIComponent(attachmentId)}`,
  );
}
