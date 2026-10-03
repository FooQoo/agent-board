import { vi } from 'vitest';
import type { Board } from '../src/types';

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
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** Replaces `fetch` with a mock that serves `GET /api/board` from `getBoard()`. */
export function stubBoardFetch(getBoard: () => Board | Error) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/board') {
      const result = getBoard();
      if (result instanceof Error) throw result;
      return jsonResponse(result);
    }
    return jsonResponse({ error: { code: 'not_found', message: 'not found.', reason: url } }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
