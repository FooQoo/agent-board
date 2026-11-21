import { delay, http, HttpResponse, sse, type RequestHandler } from 'msw';
import type { ChangedEvent } from '../../../shared/data/api/contracts.ts';
import type { MockResponse, MockServer } from '../mock-server/server.ts';
import { toMockRequest, toResponseInit } from './request.ts';

/**
 * MSW handlers over the sample-data server: the one transport that dev sample-data mode, the
 * browser demo, Storybook and the unit tests share. The server keeps the boards, the routes and
 * the changes; the handlers only carry a request to `MockServer.handle()` and its answer or its
 * `changed` events back. The paths are relative, so they match on the origin of the page.
 */

export interface MockHandlerOptions {
  /** The query of the page (`location.search`), which the server reads as page parameters. */
  page?: () => string;
}

/** The events of `/api/events`: the SSE `ready` once the stream opens, then each `changed`. */
type StreamEvents = { ready: Record<string, never>; changed: ChangedEvent };

const pageQuery = () => globalThis.location?.search ?? '';

/** Handlers that answer `/api/*`, the sample picture under `/__mock/`, and the event stream. */
export function mockHandlers(
  server: MockServer,
  options: MockHandlerOptions = {},
): RequestHandler[] {
  const page = options.page ?? pageQuery;

  const respond = (result: MockResponse) => {
    const { body, init } = toResponseInit(result);
    return new HttpResponse(body, init);
  };

  const answer = async ({ request }: { request: Request }) => {
    const result = server.handle(await toMockRequest(request, page()));
    if (result === null || result.kind === 'events') return new HttpResponse(null, { status: 404 });
    if (result.delayMs) await delay(result.delayMs);
    return respond(result);
  };

  return [
    // A stream the server refuses (`?disconnect=1`) is answered as an error; any other `/api/events`
    // request falls through to the stream below.
    http.get('/api/events', async ({ request }) => {
      const result = server.handle(await toMockRequest(request, page()));
      return result?.kind === 'response' ? respond(result) : undefined;
    }),
    sse<StreamEvents>('/api/events', ({ request, client }) => {
      client.send({ event: 'ready', data: {} });
      const unsubscribe = server.subscribe((event) => {
        // A change reaches the page after the answer to the write that made it.
        setTimeout(() => {
          if (!request.signal.aborted) client.send({ event: 'changed', data: event });
        }, 0);
      });
      request.signal.addEventListener('abort', unsubscribe, { once: true });
    }),
    http.all('/api/*', answer),
    http.all('/__mock/*', answer),
  ];
}
