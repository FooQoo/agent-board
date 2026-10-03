import type { Board } from './types';

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
