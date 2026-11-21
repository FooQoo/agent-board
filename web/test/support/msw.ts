import type { UnhandledFrameHandle } from 'msw';
import { setupServer } from 'msw/node';
import { mockHandlers, type MockHandlerOptions } from '../../src/app/development/mocks/handlers';
import type { MockServer } from '../../src/app/development/mock-server/server';

/** The MSW server of the unit tests. `test/setup.ts` starts it, and resets it after each test. */
export const mswServer = setupServer();

/** Answers `/api/*` and the event stream from `server` until the end of the test. */
export function useMockServer(server: MockServer, options?: MockHandlerOptions): void {
  mswServer.use(...mockHandlers(server, options));
}

/** A product request (`/api/` or `/__mock/`) that no handler answers is an error; others pass. */
export const failOnUnhandledProductRequest: UnhandledFrameHandle = ({ frame, defaults }) => {
  if (frame.protocol !== 'http') return;
  const { pathname } = new URL((frame.data as { request: Request }).request.url);
  if (pathname.startsWith('/api/') || pathname.startsWith('/__mock/')) defaults.error();
};
