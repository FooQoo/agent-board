import { vi } from 'vitest';
import type { Board, Card, Project, ProjectId } from '../src/types';

type Listener = (event: Event) => void;

/** Minimal stand-in for the browser's EventSource, driven by the tests. */
export class FakeEventSource {
  static instances: FakeEventSource[] = [];

  static reset(): void {
    FakeEventSource.instances = [];
  }

  static get latest(): FakeEventSource {
    const last = FakeEventSource.instances[FakeEventSource.instances.length - 1];
    if (!last) throw new Error('no EventSource was created');
    return last;
  }

  closed = false;
  private listeners = new Map<string, Set<Listener>>();

  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: Listener): void {
    const set = this.listeners.get(type) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  close(): void {
    this.closed = true;
  }

  emit(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener(new Event(type));
  }
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** What the fake backend answers: a body, a thrown network error, `not_found` or an HTTP status. */
export type FakeAnswer<T> = T | Error | 'not_found' | number;

export interface FakeBackend {
  projects: FakeAnswer<Project[]>;
  boards: Record<ProjectId, FakeAnswer<Board>>;
  archives?: Record<ProjectId, FakeAnswer<Card[]>>;
  /** Awaited before a read is answered, so a test can answer requests in any order. */
  gate?: (url: string) => Promise<void> | undefined;
  /** Answers writes (POST/DELETE). Defaults to 204 for DELETE and `{card, changed}` for POST. */
  write?: (url: string, init: RequestInit) => Response | Promise<Response>;
}

function errorResponse(status: number, code: string): Response {
  return jsonResponse({ error: { code, message: 'x', reason: 'y' } }, status);
}

function answer<T>(value: FakeAnswer<T>, build: (body: T) => unknown): Response {
  if (value instanceof Error) throw value;
  if (value === 'not_found') return errorResponse(404, 'project_not_found');
  if (typeof value === 'number') return errorResponse(value, 'database_error');
  return jsonResponse(build(value));
}

/** Replaces `fetch` with a fake of the multi-project API. Mutate `backend` between steps. */
export function stubBackend(backend: FakeBackend) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (method !== 'GET') {
      if (backend.write) return backend.write(url, init ?? {});
      return method === 'DELETE'
        ? new Response(null, { status: 204 })
        : jsonResponse({ card: {}, changed: true });
    }
    await backend.gate?.(url);
    if (url === '/api/projects') {
      return answer(backend.projects, (projects) => ({ projects, catalogVersion: 'f1' }));
    }
    const match = /^\/api\/projects\/([0-9a-f]{32})\/board$/.exec(url);
    if (match?.[1]) {
      const found = backend.boards[match[1]];
      return found === undefined
        ? errorResponse(404, 'project_not_found')
        : answer(found, (b) => b);
    }
    const archiveMatch = /^\/api\/projects\/([0-9a-f]{32})\/archive$/.exec(url);
    if (archiveMatch?.[1]) {
      const projectId = archiveMatch[1];
      const project = Array.isArray(backend.projects)
        ? backend.projects.find((item) => item.id === projectId)
        : undefined;
      if (!project) return errorResponse(404, 'project_not_found');
      const archiveAnswer = backend.archives?.[projectId] ?? [];
      return answer(archiveAnswer, (cards) => ({
        project: project ?? { id: projectId, name: 'unknown', createdAt: '' },
        revision: 1,
        cursor: `${projectId}:1`,
        cards,
      }));
    }
    return errorResponse(404, 'not_found');
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** A promise that a test settles by hand. */
export function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
