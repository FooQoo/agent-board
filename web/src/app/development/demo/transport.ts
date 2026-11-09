import type { MockRequest, MockServer } from '../mock-server/server.ts';

/**
 * The browser transport of the demo build: `fetch` and `EventSource` carry `/api/*` (and the
 * sample picture under `/__mock/`) to the
 * sample-data server in the page instead of the network, so the screens run unchanged on a static
 * site. Requests to any other address go to the real `fetch`.
 */

export interface DemoTransportOptions {
  /** The origin of the page; a request to another origin is never the server's. */
  origin: string;
  /** The query of the page (`location.search`), which the server reads as page parameters. */
  page: () => string;
  /** The `fetch` that requests outside `/api/` go to. */
  fetch: typeof fetch;
}

const SERVER_PREFIXES = ['/api/', '/__mock/'];

/** The path and query of `url` when it names the sample-data server, or null. */
export function serverPath(url: string, origin: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url, `${origin}/`);
  } catch {
    return null;
  }
  if (parsed.origin !== origin) return null;
  if (!SERVER_PREFIXES.some((prefix) => parsed.pathname.startsWith(prefix))) return null;
  return `${parsed.pathname}${parsed.search}`;
}

/** The body the server reads: text as it is, and the `metadata` field of a form. */
async function bodyText(body: unknown): Promise<string> {
  if (body === undefined || body === null) return '';
  if (typeof body === 'string') return body;
  if (body instanceof FormData) {
    const metadata = body.get('metadata');
    return typeof metadata === 'string' ? metadata : '';
  }
  if (body instanceof URLSearchParams) return body.toString();
  if (body instanceof Blob) return body.text();
  return '';
}

function headerRecord(headers: Headers): Record<string, string> {
  const record: Record<string, string> = {};
  headers.forEach((value, name) => {
    record[name.toLowerCase()] = value;
  });
  return record;
}

const abortError = () => new DOMException('The request was aborted.', 'AbortError');

/** Waits `ms`, or rejects as `fetch` does when `signal` aborts first. */
function wait(ms: number, signal: AbortSignal | null | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** A `fetch` that answers `/api/*` from `server` and passes everything else to `options.fetch`. */
export function createDemoFetch(server: MockServer, options: DemoTransportOptions): typeof fetch {
  return async (input, init) => {
    const request = input instanceof Request ? input : null;
    const url = request ? request.url : input instanceof URL ? input.href : String(input);
    const path = serverPath(url, options.origin);
    if (path === null) return options.fetch(input, init);
    const signal = init?.signal ?? request?.signal;
    if (signal?.aborted) throw abortError();
    const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();
    const headers = new Headers(init?.headers ?? request?.headers);
    const body =
      init?.body !== undefined
        ? await bodyText(init.body)
        : request && method !== 'GET' && method !== 'HEAD'
          ? await request.text()
          : '';
    const mockRequest: MockRequest = {
      method,
      url: path,
      page: options.page(),
      headers: headerRecord(headers),
      body,
    };
    const result = server.handle(mockRequest);
    if (result === null || result.kind === 'events')
      return new Response(null, { status: 404, statusText: 'Not Found' });
    await wait(result.delayMs ?? 0, signal);
    const empty = result.status === 204 || result.status === 304 || result.body === '';
    return new Response(empty ? null : result.body, {
      status: result.status,
      headers: result.headers,
    });
  };
}

const CONNECTING = 0;
const OPEN = 1;
const CLOSED = 2;

/**
 * An `EventSource` class whose `/api/events` stream comes from `server`: `ready` once it opens,
 * then each `changed` event as the server reports it. A refused stream ends with `error`.
 */
export function createDemoEventSource(
  server: MockServer,
  options: Pick<DemoTransportOptions, 'origin' | 'page'>,
): typeof EventSource {
  class DemoEventSource extends EventTarget {
    static readonly CONNECTING = CONNECTING;
    static readonly OPEN = OPEN;
    static readonly CLOSED = CLOSED;
    readonly CONNECTING = CONNECTING;
    readonly OPEN = OPEN;
    readonly CLOSED = CLOSED;
    readonly url: string;
    readonly withCredentials = false;
    readyState: number = CONNECTING;
    onopen: ((this: EventSource, event: Event) => unknown) | null = null;
    onmessage: ((this: EventSource, event: MessageEvent) => unknown) | null = null;
    onerror: ((this: EventSource, event: Event) => unknown) | null = null;
    #unsubscribe: (() => void) | null = null;

    constructor(url: string | URL, _init?: EventSourceInit) {
      super();
      this.url = new URL(String(url), `${options.origin}/`).href;
      // As over the network, the stream opens after the code that made it has run.
      setTimeout(() => this.#connect(), 0);
    }

    #connect() {
      if (this.readyState === CLOSED) return;
      const path = serverPath(this.url, options.origin);
      const result =
        path === null ? null : server.handle({ method: 'GET', url: path, page: options.page() });
      if (result?.kind !== 'events') {
        this.readyState = CLOSED;
        this.#emit(new Event('error'));
        return;
      }
      this.readyState = OPEN;
      this.#emit(new Event('open'));
      this.#emit(new MessageEvent('ready', { data: '{}' }));
      this.#unsubscribe = server.subscribe((event) => {
        const data = JSON.stringify(event);
        // A change reaches the page after the answer to the write that made it.
        setTimeout(() => {
          if (this.readyState === OPEN) this.#emit(new MessageEvent('changed', { data }));
        }, 0);
      });
    }

    #emit(event: Event) {
      const handler =
        event.type === 'open' ? this.onopen : event.type === 'error' ? this.onerror : null;
      handler?.call(this as unknown as EventSource, event);
      this.dispatchEvent(event);
    }

    close() {
      this.readyState = CLOSED;
      this.#unsubscribe?.();
      this.#unsubscribe = null;
    }
  }
  return DemoEventSource as unknown as typeof EventSource;
}

/** Puts the demo `fetch` and `EventSource` in place of the browser's on `target` (the window). */
export function installDemoTransport(
  server: MockServer,
  target: { fetch: typeof fetch; EventSource: typeof EventSource; location: Location },
): void {
  const options: DemoTransportOptions = {
    origin: target.location.origin,
    page: () => target.location.search,
    fetch: target.fetch.bind(target),
  };
  target.fetch = createDemoFetch(server, options);
  target.EventSource = createDemoEventSource(server, options);
}
