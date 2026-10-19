import { afterEach, expect } from 'vitest';
import { assertNoProductRequests, installNetworkGuard } from './support/network-guard';

// Both browser projects run with the product's requests blocked, as the preview does for Stories.
installNetworkGuard();

// After each test: no product request was attempted, and no preference was written to localStorage.
afterEach(() => {
  assertNoProductRequests();
  const written = Object.keys(window.localStorage).filter((key) => key.startsWith('agboard.'));
  for (const key of written) window.localStorage.removeItem(key);
  expect(written, 'a test must not write preferences to localStorage').toEqual([]);
});
