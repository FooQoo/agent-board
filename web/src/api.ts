import type { ApiError, Assignee, Board, Card, ColumnName, ProjectId, ProjectList } from './types';

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

function projectPath(projectId: ProjectId): string {
  return `/api/projects/${encodeURIComponent(projectId)}`;
}

export function fetchProjects(): Promise<ProjectList> {
  return getJson<ProjectList>('/api/projects');
}

export function fetchBoard(projectId: ProjectId): Promise<Board> {
  return getJson<Board>(`${projectPath(projectId)}/board`);
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

/** A rejected write. `code` is the API error code (for example `request_changed`), when the body has one. */
export class WriteError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
  ) {
    super(message);
  }
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
    );
  }
  return body as T;
}

export async function createCard(
  projectId: ProjectId,
  input: { title: string; description: string; assignee: Assignee },
) {
  return postCard<{ card: Card }>(`${projectPath(projectId)}/cards`, input);
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

export async function answerRequest(
  projectId: ProjectId,
  id: number,
  requestId: string,
  reason: string,
) {
  return postCard<{ card: Card; changed: boolean }>(
    `${projectPath(projectId)}/cards/${id}/answer`,
    { requestId, reason },
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

/** Makes a card a draft (`true`) or finalizes it (`false`). Only an idle card can become a draft. */
export async function setDraft(projectId: ProjectId, id: number, isDraft: boolean) {
  return sendCard('PUT', `${projectPath(projectId)}/cards/${id}/draft`, { isDraft });
}
