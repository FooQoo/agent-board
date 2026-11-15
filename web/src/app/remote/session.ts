// The board app's session through the ngrok entrance. The page served there carries no token: a
// session cookie, which the four-digit passcode opens, authenticates every request, and writes add
// the session's CSRF token. The local page carries its token and has no session.

import { readToken, setCsrfToken } from '../../shared/api/http';
import {
  currentCsrf,
  openSessionAt,
  reportAuthLoss,
  unlockAt,
  type MonitorSession,
} from '../../pages/monitor/session';

export const REMOTE_SESSION_URL = '/api/remote/session';
export const REMOTE_UNLOCK_URL = '/api/remote/unlock';
const REMOTE_PREFIX = '/api/remote/';

/**
 * True when the board page came through the ngrok entrance: its HTML holds no token. The
 * sample-data mode and the demo have no server and no session.
 */
export function usesRemoteSession(): boolean {
  const serverless = import.meta.env.MODE === 'mock' || import.meta.env.MODE === 'demo';
  return !serverless && readToken() === '';
}

function keep(session: MonitorSession): MonitorSession {
  setCsrfToken(currentCsrf() ?? session.csrfToken);
  return session;
}

/** Ask whether the session is live; nothing is started here. */
export async function openRemoteSession(): Promise<MonitorSession> {
  return keep(await openSessionAt(REMOTE_SESSION_URL));
}

/** Trade the passcode for a session; the cookie is set by the server, the CSRF token kept here. */
export async function unlockRemote(code: string): Promise<MonitorSession> {
  return keep(await unlockAt(REMOTE_UNLOCK_URL, code));
}

function pathOf(input: RequestInfo | URL): string {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  try {
    return new URL(raw, window.location.origin).pathname;
  } catch {
    return raw;
  }
}

/**
 * Tells the passcode gate when a board request is answered 401, so that an ended session
 * (expired, or the connection started again) brings the passcode screen back.
 */
export function watchSessionLoss(): void {
  const original = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const response = await original(input, init);
    if (response.status === 401 && !pathOf(input).startsWith(REMOTE_PREFIX)) {
      setCsrfToken('');
      reportAuthLoss('session_required');
    }
    return response;
  };
}
