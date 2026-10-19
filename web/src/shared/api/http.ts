import type { ApiError, ProjectId } from './contracts';

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

export async function getJson<T>(path: string): Promise<T> {
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

export function projectPath(projectId: ProjectId): string {
  return `/api/projects/${encodeURIComponent(projectId)}`;
}
