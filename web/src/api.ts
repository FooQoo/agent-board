import { i18n } from './i18n';
import type {
  ApiError,
  Assignee,
  Board,
  AcceptanceItem,
  Task,
  ColumnName,
  Epic,
  EpicRef,
  Problem,
  ProjectId,
  ProjectList,
} from './types';
import type { EditorAttachment } from './components/editor/attachmentTypes';
import type { AnswerInput } from './lib/answer';
import { writeFailure } from './lib/writeErrors';

export { problemOf, STALE_PAGE_EVENT, WriteError, writeFailure } from './lib/writeErrors';

const TOKEN_META = 'agboard-token';

/** The server puts the session token for writes into `<meta name="agboard-token">`. */
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
type WireTask = Omit<Task, 'epic'> & { epicId: string | null };

/** The board as the server writes it. The snapshot joins each card with its epic. */
interface WireBoard {
  project: Board['project'];
  version: string;
  cursor: string;
  epics: Epic[];
  epicTaskCounts: Board['epicTaskCounts'];
  tasks: WireTask[];
  problems: Problem[];
}

function toTask(wire: WireTask, epics: readonly Epic[]): Task {
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
    epicTaskCounts: wire.epicTaskCounts,
    tasks: wire.tasks.map((task) => toTask(task, wire.epics)),
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
  /** The archived cards. Each card's epic is resolved against `epics` from the same response. */
  tasks: Task[];
  /** The project's epics, read from the same snapshot as `tasks`. */
  epics: Epic[];
}

export async function fetchArchive(projectId: ProjectId): Promise<ArchiveResponse> {
  const wire = await getJson<Omit<ArchiveResponse, 'tasks'> & { tasks: WireTask[] }>(
    `${projectPath(projectId)}/archive`,
  );
  return { ...wire, tasks: wire.tasks.map((task) => toTask(task, wire.epics)) };
}

async function postEmpty(path: string): Promise<{ task: Task }> {
  const response = await fetch(path, {
    method: 'POST',
    headers: {
      'X-Agboard-Token': readToken(),
      'X-Agboard-Language': i18n.resolvedLanguage === 'ja' ? 'ja' : 'en',
    },
  });
  const body = (await response.json()) as { task?: Task; error?: ApiError['error'] };
  if (!response.ok || !body.task)
    throw writeFailure(
      body.error?.reason ?? `Request failed (${response.status})`,
      response.status,
      body.error?.code ?? null,
      body.error?.message ?? null,
    );
  return { task: body.task };
}

export function archiveTask(projectId: ProjectId, id: number) {
  return postEmpty(`${projectPath(projectId)}/tasks/${id}/archive`);
}

export function restoreTask(projectId: ProjectId, id: number) {
  return postEmpty(`${projectPath(projectId)}/tasks/${id}/restore`);
}

export async function archiveDone(projectId: ProjectId, ids: readonly number[]) {
  return postTask<{ tasks: Task[]; archivedCount: number }>(
    `${projectPath(projectId)}/tasks/archive-done`,
    { ids },
  );
}

/**
 * - `deleted`: the server answered 204.
 * - `not_found`: the card is already gone (404).
 * - `failed`: anything else, including network errors.
 */
export type DeleteResult = 'deleted' | 'not_found' | 'failed';

export async function deleteTask(projectId: ProjectId, id: number): Promise<DeleteResult> {
  try {
    const response = await fetch(`${projectPath(projectId)}/tasks/${id}`, {
      method: 'DELETE',
      headers: {
        'X-Agboard-Token': readToken(),
        'X-Agboard-Language': i18n.resolvedLanguage === 'ja' ? 'ja' : 'en',
      },
    });
    if (response.status === 204) return 'deleted';
    if (response.status === 404) return 'not_found';
    return 'failed';
  } catch {
    return 'failed';
  }
}

async function postTask<T>(path: string, value: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Agboard-Token': readToken(),
      'X-Agboard-Language': i18n.resolvedLanguage === 'ja' ? 'ja' : 'en',
    },
    body: JSON.stringify(value),
  });
  const body = (await response.json()) as {
    task?: Task;
    changed?: boolean;
    error?: ApiError['error'];
  };
  if (!response.ok) {
    throw writeFailure(
      body.error?.reason ?? `Request failed (${response.status})`,
      response.status,
      body.error?.code ?? null,
      body.error?.message ?? null,
    );
  }
  return body as T;
}

/**
 * A new card. Give either `description` (the whole TASK.md text) or `body` with `acceptance`; the server
 * writes the frontmatter from the parts.
 */
export async function createTask(
  projectId: ProjectId,
  input: {
    title: string;
    description?: string;
    body?: string;
    acceptance?: AcceptanceItem[];
    assignee: Assignee;
    isDraft?: boolean;
  },
) {
  return postTask<{ task: Task }>(`${projectPath(projectId)}/tasks`, {
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
  const response = await fetch(path, {
    method,
    headers: {
      'X-Agboard-Token': readToken(),
      'X-Agboard-Language': i18n.resolvedLanguage === 'ja' ? 'ja' : 'en',
    },
    body,
  });
  const data = (await response.json()) as { task?: Task; error?: ApiError['error'] };
  if (!response.ok || !data.task)
    throw writeFailure(
      data.error?.reason ?? `Request failed (${response.status})`,
      response.status,
      data.error?.code ?? null,
      data.error?.message ?? null,
    );
  return { task: data.task };
}

export function createTaskMultipart(
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
    `${projectPath(projectId)}/tasks/multipart`,
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
export async function createNewTask(
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
    return createTaskMultipart(projectId, {
      title: input.title,
      description: input.description,
      assignee: input.assignee,
      isDraft,
      requestId: input.requestId,
      attachments: input.attachments,
    });
  return createTask(projectId, {
    title: input.title,
    description: input.description,
    assignee: input.assignee,
    isDraft,
  });
}

export async function moveTask(
  projectId: ProjectId,
  id: number,
  taskStatus: ColumnName,
  reason: string,
) {
  return postTask<{ task: Task; changed: boolean }>(`${projectPath(projectId)}/tasks/${id}/move`, {
    taskStatus,
    reason,
  });
}

/** Puts a card just before `beforeId` in its lane, or at the end of the lane when `beforeId` is null. */
export async function reorderTask(projectId: ProjectId, id: number, beforeId: number | null) {
  return postTask<{ task: Task; changed: boolean }>(
    `${projectPath(projectId)}/tasks/${id}/reorder`,
    { beforeId },
  );
}

export async function answerRequest(projectId: ProjectId, id: number, input: AnswerInput) {
  return postTask<{ task: Task; changed: boolean }>(
    `${projectPath(projectId)}/tasks/${id}/answer`,
    input,
  );
}

/** Sends a write that answers `{card}` or an error body (PATCH and PUT). */
async function sendTask(
  method: 'PATCH' | 'PUT',
  path: string,
  value: unknown,
): Promise<{ task: Task }> {
  const response = await fetch(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Agboard-Token': readToken(),
      'X-Agboard-Language': i18n.resolvedLanguage === 'ja' ? 'ja' : 'en',
    },
    body: JSON.stringify(value),
  });
  const body = (await response.json()) as { task?: Task; error?: ApiError['error'] };
  if (!response.ok || body.task === undefined) {
    throw writeFailure(
      body.error?.reason ?? `Request failed (${response.status})`,
      response.status,
      body.error?.code ?? null,
      body.error?.message ?? null,
    );
  }
  return { task: body.task };
}

/**
 * Saves the title and/or description of a draft. Body and acceptance are partial inputs applied to
 * the latest TASK.md under the server's write lock; history is never sent by this editor. `finalize`
 * also hands the card back to the agents in the same step.
 */
export async function editTask(
  projectId: ProjectId,
  id: number,
  input: {
    title?: string;
    description?: string;
    body?: string;
    acceptance?: AcceptanceItem[];
    finalize?: boolean;
  },
) {
  return sendTask('PATCH', `${projectPath(projectId)}/tasks/${id}`, input);
}

export function editTaskMultipart(
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
    `${projectPath(projectId)}/tasks/${id}/multipart`,
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
  return sendTask('PUT', `${projectPath(projectId)}/tasks/${id}/draft`, { isDraft });
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
      'X-Agboard-Token': readToken(),
      'X-Agboard-Language': i18n.resolvedLanguage === 'ja' ? 'ja' : 'en',
    },
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  });
  const data = (await response.json()) as { epic?: Epic; error?: ApiError['error'] };
  if (!response.ok || data.epic === undefined)
    throw writeFailure(
      data.error?.reason ?? `Request failed (${response.status})`,
      response.status,
      data.error?.code ?? null,
      data.error?.message ?? null,
    );
  return { epic: data.epic };
}

/**
 * Deletes an epic. The server answers 204 when it is gone and refuses with `epic_in_use` while a task
 * (archived ones included) still names it.
 */
export async function deleteEpic(projectId: ProjectId, epicId: string): Promise<void> {
  const response = await fetch(`${projectPath(projectId)}/epics/${encodeURIComponent(epicId)}`, {
    method: 'DELETE',
    headers: { 'X-Agboard-Token': readToken() },
  });
  if (response.ok) return;
  const body = (await response.json().catch(() => ({}))) as { error?: ApiError['error'] };
  throw writeFailure(
    body.error?.reason ?? `Request failed (${response.status})`,
    response.status,
    body.error?.code ?? null,
    body.error?.message ?? null,
  );
}

/** The name, color, draft flag or plan of an epic. Only the given fields change. */
export function updateEpic(
  projectId: ProjectId,
  epicId: string,
  input: {
    name?: string;
    color?: string;
    isDraft?: boolean;
    plan?: string;
    body?: string;
    /** The card order of the epic: card IDs, first is first. */
    priority?: number[];
  },
) {
  return sendEpic('PATCH', `${projectPath(projectId)}/epics/${encodeURIComponent(epicId)}`, input);
}

/** Puts a card into the epic (`epicId`) or takes it out (`null`). */
export function setTaskEpic(projectId: ProjectId, id: number, epicId: string | null) {
  return sendTask('PUT', `${projectPath(projectId)}/tasks/${id}/epic`, { epicId });
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
