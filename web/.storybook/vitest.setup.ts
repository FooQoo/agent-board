import { afterEach, beforeAll, expect } from 'vitest';
import { assertNoUnhandledRequests, resetHandlers, startWorker } from './support/msw';

// Both browser projects answer product requests through MSW, as the preview does for Stories; a
// request no handler answers fails.
beforeAll(async () => {
  await startWorker();
});

// After each test: no product request was attempted, and no preference was written to localStorage.
afterEach(() => {
  resetHandlers();
  assertNoUnhandledRequests();
  const written = Object.keys(window.localStorage).filter((key) => key.startsWith('agboard.'));
  for (const key of written) window.localStorage.removeItem(key);
  expect(written, 'a test must not write preferences to localStorage').toEqual([]);
});
