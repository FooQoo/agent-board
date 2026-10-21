// The phone's access to the monitor: its error type, the app session and the CSRF token.

export const MONITOR_API_BASE = '/monitor/api/';
export const MONITOR_REQUEST_TIMEOUT_MS = 10_000;
const MONITOR_TOKEN_META = 'agboard-monitor-token';
const SESSION_URL = `${MONITOR_API_BASE}session`;

export interface MonitorRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
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

export function readMonitorToken(): string {
  return (
    document.querySelector<HTMLMetaElement>(`meta[name="${MONITOR_TOKEN_META}"]`)?.content ?? ''
  );
}

/**
 * Why the monitor lost its access.
 * - `session_required`: the app session is gone; the page asked for data without a live one.
 * - `auth_redirect`: the answer was not the monitor's JSON (the Edge sent the sign-in page).
 * - `unavailable`: the connection is stopped or no longer allowed.
 */
export type MonitorAuthLoss = 'session_required' | 'auth_redirect' | 'unavailable';

const authListeners = new Set<(loss: MonitorAuthLoss) => void>();
let csrfToken: string | null = null;

/** The CSRF token of the current session, if one was fetched. */
export const currentCsrf = (): string | null => csrfToken;
/** Drop the token so the next write fetches a new one. */
export const forgetCsrf = (): void => {
  csrfToken = null;
};

/** Be told whenever a request shows the phone no longer has access. Returns the unsubscribe. */
export function onMonitorAuthLoss(listener: (loss: MonitorAuthLoss) => void): () => void {
  authListeners.add(listener);
  return () => authListeners.delete(listener);
}

export function reportAuthLoss(loss: MonitorAuthLoss): void {
  csrfToken = null;
  for (const listener of [...authListeners]) listener(loss);
}

/**
 * True when the page came through the ngrok Edge: its HTML carries no token, so reads and answers
 * rely on the app session cookie and the CSRF token from `GET /monitor/api/session`. A page with a
 * token (the existing remote monitor) keeps sending it and has no session.
 */
export function usesMonitorSession(): boolean {
  return readMonitorToken() === '';
}

export interface MonitorSession {
  csrfToken: string;
  expiresAt: number;
  expiresInSeconds: number;
}

/**
 * Ask for the app session and keep its CSRF token in memory only. A new session starts when the
 * cookie is missing or expired. Anything that is not the monitor's JSON is treated as the Edge
 * asking for sign-in: it is never followed or parsed here.
 */
export async function openSession(options: MonitorRequestOptions = {}): Promise<MonitorSession> {
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
      response = await fetch(SESSION_URL, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        redirect: 'manual',
        signal: controller.signal,
      });
    } catch (cause) {
      if (external?.aborted) throw external.reason ?? cause;
      throw new MonitorClientError(
        'GET session failed.',
        0,
        timedOut ? 'timeout' : 'network_error',
        timedOut ? 'Request timed out.' : 'Network request failed.',
      );
    }
    if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400))
      throw new MonitorClientError('The sign-in page was returned.', 0, 'auth_redirect');
    if (response.status === 403)
      throw new MonitorClientError('The monitor is not available.', 403, 'unavailable');
    if (response.status >= 500)
      throw new MonitorClientError('The monitor failed.', response.status, 'server_error');
    let body: Partial<MonitorSession> = {};
    try {
      body = (await response.json()) as Partial<MonitorSession>;
    } catch {
      // Not JSON: the Edge's sign-in or error page.
    }
    if (!response.ok || typeof body.csrfToken !== 'string' || body.csrfToken === '')
      throw new MonitorClientError(
        'The sign-in page was returned.',
        response.status,
        'auth_redirect',
      );
    csrfToken = body.csrfToken;
    return {
      csrfToken: body.csrfToken,
      expiresAt: Number(body.expiresAt ?? 0),
      expiresInSeconds: Number(body.expiresInSeconds ?? 0),
    };
  } finally {
    clearTimeout(timeout);
    external?.removeEventListener('abort', abortFromCaller);
  }
}
