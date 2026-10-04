import type { ApiError, Assignee, Board, Card, ColumnName } from './types';

const TOKEN_META = 'skan-token';

/** The server puts the session token for deletes into `<meta name="skan-token">`. */
export function readToken(): string {
  const meta = document.querySelector<HTMLMetaElement>(`meta[name="${TOKEN_META}"]`);
  return meta?.content ?? '';
}

export async function fetchBoard(): Promise<Board> {
  const response = await fetch('/api/board', {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`GET /api/board failed with status ${response.status}`);
  }
  return (await response.json()) as Board;
}

/**
 * - `deleted`: the server answered 204.
 * - `not_found`: the card is already gone (404).
 * - `failed`: anything else, including network errors.
 */
export type DeleteResult = 'deleted' | 'not_found' | 'failed';

export async function deleteCard(id: number): Promise<DeleteResult> {
  try {
    const response = await fetch(`/api/cards/${id}`, {
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
  if (!response.ok) throw new Error(body.error?.reason ?? `Request failed (${response.status})`);
  return body as T;
}

export async function createCard(input: {
  title: string;
  description: string;
  assignee: Assignee;
}) {
  return postCard<{ card: Card }>('/api/cards', { ...input, actor: 'human' });
}

export async function moveCard(id: number, cardStatus: ColumnName, reason: string) {
  return postCard<{ card: Card; changed: boolean }>(`/api/cards/${id}/move`, {
    cardStatus,
    reason,
    actor: 'human',
  });
}

export async function answerRequest(id: number, requestId: string, reason: string) {
  return postCard<{ card: Card; changed: boolean }>(`/api/cards/${id}/answer`, {
    requestId,
    reason,
    actor: 'human',
  });
}
