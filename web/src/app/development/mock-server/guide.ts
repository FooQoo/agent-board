import type { MockResponse, Routes } from './types.ts';
import { error, forbidden, invalidJson, json, parseBody } from './wire.ts';

// The first-run guide's routes, as `agboard serve` answers them (`src/server/api/onboarding.rs`):
// the guide runs in the browser, so the server only keeps whether it has been seen. The state
// lives in memory, so every new page (and every reset) offers the guide again.

type GuideStatus = 'unseen' | 'completed' | 'skipped';

export interface MockGuide {
  routes: Routes;
  /** Back to a guide that has never been seen, as a new page starts. */
  reset(): void;
}

export function createGuide(): MockGuide {
  let status: GuideStatus = 'unseen';
  const answer = (): MockResponse => json(200, { formatVersion: 2, status });

  const routes: Routes = (_context, request) => {
    const path = request.url.pathname;
    if (request.method === 'GET' && path === '/api/onboarding') return answer();
    if (request.method !== 'POST' || path !== '/api/onboarding/seen') return null;
    if (!request.token) return forbidden();
    const input = parseBody(request.body);
    if (!input) return invalidJson();
    const outcome = input.outcome;
    if (outcome !== 'completed' && outcome !== 'skipped')
      return error(422, 'invalid_value', 'invalid outcome.', 'Use "completed" or "skipped".');
    status = outcome;
    return answer();
  };

  return {
    routes,
    reset() {
      status = 'unseen';
    },
  };
}
