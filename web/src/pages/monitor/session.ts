// The phone's access to the board through the ngrok entrance: its error type, the app session and
// the CSRF token.

export const MONITOR_REQUEST_TIMEOUT_MS = 10_000;

export interface MonitorRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** The body of an error answer of the monitor. */
export interface ErrorBody {
  error?: { code?: string; message?: string; reason?: string };
}

export class MonitorClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
    readonly reason: string | null = null,
  ) {
    super(message);
    this.name = 'MonitorClientError';
  }
}

/**
 * Why the monitor lost its access.
 * - `session_required`: the app session is gone; the page asked for data without a live one.
 * - `unexpected_response`: the answer was not the monitor's JSON (something else answered).
 * - `unavailable`: the connection is stopped or the page is not allowed to use it.
 */
export type MonitorAuthLoss = 'session_required' | 'unexpected_response' | 'unavailable';

const authListeners = new Set<(loss: MonitorAuthLoss) => void>();
let csrfToken: string | null = null;

/** The CSRF token of the current session, if one was fetched. */
export const currentCsrf = (): string | null => csrfToken;

/** Be told whenever a request shows the phone no longer has access. Returns the unsubscribe. */
export function onMonitorAuthLoss(listener: (loss: MonitorAuthLoss) => void): () => void {
  authListeners.add(listener);
  return () => authListeners.delete(listener);
}

export function reportAuthLoss(loss: MonitorAuthLoss): void {
  csrfToken = null;
  for (const listener of [...authListeners]) listener(loss);
}

export interface MonitorSession {
  csrfToken: string;
  expiresAt: number;
  expiresInSeconds: number;
}

/**
 * One request to the session routes, with the caller's abort signal and the timeout. `handle`
 * reads the response inside that window. A failure to get any answer is a `network_error` or a
 * `timeout`.
 */
async function exchange<T>(
  path: string,
  init: RequestInit,
  options: MonitorRequestOptions,
  handle: (response: Response) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const external = options.signal;
  if (external?.aborted) throw external.reason ?? new DOMException('Aborted', 'AbortError');
  const abortFromCaller = () => controller.abort(external?.reason);
  external?.addEventListener('abort', abortFromCaller, { once: true });
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs ?? MONITOR_REQUEST_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetch(path, {
        ...init,
        cache: 'no-store',
        redirect: 'manual',
        signal: controller.signal,
      });
    } catch (cause) {
      if (external?.aborted) throw external.reason ?? cause;
      throw new MonitorClientError(
        `${init.method ?? 'GET'} ${path} failed.`,
        0,
        timedOut ? 'timeout' : 'network_error',
        timedOut ? 'Request timed out.' : 'Network request failed.',
      );
    }
    return await handle(response);
  } finally {
    clearTimeout(timeout);
    external?.removeEventListener('abort', abortFromCaller);
  }
}

/** The error for an answer that is neither a session nor a known refusal. */
function sessionFailure(response: Response, errorCode: string | undefined): MonitorClientError {
  if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400))
    return new MonitorClientError(
      'Something other than the monitor answered.',
      0,
      'unexpected_response',
    );
  if (response.status >= 500)
    return new MonitorClientError('The monitor failed.', response.status, 'server_error');
  if (response.status === 401 && errorCode === 'session_required')
    return new MonitorClientError('The passcode is needed.', 401, 'session_required');
  if (response.status === 429 && errorCode === 'unlock_locked')
    return new MonitorClientError('Too many wrong passcodes.', 429, 'unlock_locked');
  if (response.status === 403 && errorCode === 'unlock_failed')
    return new MonitorClientError('The passcode was not accepted.', 403, 'unlock_failed');
  if (response.status === 403)
    return new MonitorClientError('The monitor is not available.', 403, 'unavailable');
  return new MonitorClientError(
    'Something other than the monitor answered.',
    response.status,
    'unexpected_response',
  );
}

interface SessionAnswer extends Partial<MonitorSession> {
  error?: { code?: string };
}

/** Keep the CSRF token of an accepted session in memory only. */
async function takeSession(response: Response): Promise<MonitorSession> {
  let body: SessionAnswer = {};
  try {
    body = (await response.json()) as SessionAnswer;
  } catch {
    // Not JSON: something other than the monitor answered.
  }
  if (!response.ok || typeof body.csrfToken !== 'string' || body.csrfToken === '')
    throw sessionFailure(response, body.error?.code);
  csrfToken = body.csrfToken;
  return {
    csrfToken: body.csrfToken,
    expiresAt: Number(body.expiresAt ?? 0),
    expiresInSeconds: Number(body.expiresInSeconds ?? 0),
  };
}

/**
 * Ask whether the app session is live at the session route (the board app's
 * `/api/remote/session`), and keep its CSRF token in memory only. Nothing starts a session here:
 * without one the server says `session_required` and the page asks for the passcode. Anything
 * that is not the server's JSON is `unexpected_response`.
 */
export function openSessionAt(
  url: string,
  options: MonitorRequestOptions = {},
): Promise<MonitorSession> {
  return exchange(url, { headers: { Accept: 'application/json' } }, options, takeSession);
}

/**
 * Trade the four-digit passcode shown on the PC for a session at the unlock route (the board app's
 * `/api/remote/unlock`). The server sets the session cookie; the CSRF token is kept in memory. A
 * wrong passcode is `unlock_failed`, and after too many in a row `unlock_locked`; the server never
 * says how many tries are left.
 */
export function unlockAt(
  url: string,
  code: string,
  options: MonitorRequestOptions = {},
): Promise<MonitorSession> {
  return exchange(
    url,
    {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    },
    options,
    takeSession,
  );
}
