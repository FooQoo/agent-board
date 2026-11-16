// The guide's two requests. The guide itself runs in the browser: the server only keeps whether
// it has been seen, so a read says "unseen", "completed" or "skipped", and one write records how
// the guide ended.

import { authHeaders } from '../../shared/api/http';

export type GuideStatus = 'unseen' | 'completed' | 'skipped';

/** How the guide ended: the user went through it, or left it. */
export type GuideOutcome = 'completed' | 'skipped';

/** `GET /api/onboarding` and the answer of the write. */
export interface GuideState {
  formatVersion: number;
  status: GuideStatus;
}

async function send(method: 'GET' | 'POST', body?: GuideOutcome): Promise<GuideState> {
  const response = await fetch(body ? '/api/onboarding/seen' : '/api/onboarding', {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...authHeaders(),
    },
    body: body ? JSON.stringify({ outcome: body }) : undefined,
  });
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return (await response.json()) as GuideState;
}

export function readGuide(): Promise<GuideState> {
  return send('GET');
}

/** Records that the guide has been seen; the server then no longer offers it. */
export function markGuideSeen(outcome: GuideOutcome): Promise<GuideState> {
  return send('POST', outcome);
}
