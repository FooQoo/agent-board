// Stories answer product requests through MSW, the same handlers the unit tests, the dev sample-data
// mode and the demo use. A Story that wants data adds the handlers over a sample-data server with
// `useMockServer`; a product request no handler answers fails and is recorded, so the test that made
// it can fail too. Navigation, assets and other requests pass.
import { HttpResponse, type UnhandledFrameHandle } from 'msw';
import { setupWorker } from 'msw/browser';
import { mockHandlers, type MockHandlerOptions } from '../../src/app/development/mocks/handlers';
import {
  createMockServer,
  type MockServer,
  type MockServerOptions,
} from '../../src/app/development/mock-server/server';
import type { Board } from '../../src/shared/api/contracts';
import fixture from '../../test/fixtures/board.json';
import longMarkdown from '../../test/fixtures/long-markdown.md?raw';

export const worker = setupWorker();

const PRODUCT_PREFIXES = ['/api/', '/__mock/'];

/** Product requests no handler answered, as `METHOD url` strings, until `assertNoUnhandledRequests`. */
const unhandled: string[] = [];

const onUnhandledFrame: UnhandledFrameHandle = ({ frame }) => {
  if (frame.protocol !== 'http') return;
  const { request } = frame.data as { request: Request };
  const { pathname } = new URL(request.url);
  if (!PRODUCT_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return;
  // A picture a Story names (an `<img>` under `/api/`) is not a data request: it fails as a missing
  // file, as it did before the worker, and no test is failed for it.
  if (request.headers.get('accept')?.startsWith('image/')) return;
  unhandled.push(`${request.method} ${request.url}`);
  // A network error, as `fetch` failed before the worker; the test that made it fails at its end.
  frame.errorWith(HttpResponse.error());
};

let started: Promise<unknown> | null = null;

/** Starts the worker once; the preview and the support tests both call it. */
export function startWorker(): Promise<unknown> {
  started ??= worker.start({
    serviceWorker: { url: `${import.meta.env.BASE_URL}mockServiceWorker.js` },
    onUnhandledFrame,
    quiet: true,
  });
  return started;
}

/** A sample-data server over the fixture board, for a Story that needs the product API. */
export function createStoryServer(options: Partial<MockServerOptions> = {}): MockServer {
  return createMockServer({ fixture: fixture as unknown as Board, longMarkdown, ...options });
}

/** Answers product requests from `server` until the end of the Story. */
export function useMockServer(
  server: MockServer = createStoryServer(),
  options?: MockHandlerOptions,
): void {
  worker.use(...mockHandlers(server, options));
}

/** Removes the handlers a Story added. */
export function resetHandlers(): void {
  worker.resetHandlers();
}

/** Throws when a product request went unanswered since the last call, and clears the record. */
export function assertNoUnhandledRequests(): void {
  if (unhandled.length === 0) return;
  const attempts = unhandled.splice(0).join('\n');
  throw new Error(`Product requests no handler answered, made by a story:\n${attempts}`);
}
