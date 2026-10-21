import { i18n } from '../../shared/i18n';
import { readToken } from '../../shared/api/http';
import type { ConnectionStatus } from './ui/connectionProgress';

/** The fixed reasons a start can fail; the server never sends anything else. */
export type FailureCode =
  | 'connect_failed'
  | 'endpoint_failed'
  | 'public_url_invalid'
  | 'internal'
  | 'config_unreadable'
  | 'config_invalid';

export type TokenSource = 'env' | 'keychain' | 'session';

/**
 * What `GET /api/monitor-connections` returns. The ngrok token is never in it. The passcode is,
 * for the PC to show, while the connection is ready.
 */
export interface ConnectionSnapshot {
  status: ConnectionStatus;
  url: string | null;
  revision: number;
  settings: {
    enabled: boolean;
    domain: string | null;
  };
  /** Whether a token is available: from the environment, the keychain or this run. */
  tokenConfigured: boolean;
  /** Where the token in use comes from; the value itself is never sent. */
  tokenSource: TokenSource | null;
  /** Whether the OS keychain can hold a token on this PC. */
  keychainAvailable: boolean;
  /** Whether a token is saved in the keychain. */
  keychainTokenSaved: boolean;
  failure: FailureCode | null;
  /** The 4-digit passcode of the running connection; absent unless the status is `ready`. */
  passcode?: string;
}

/** A request the server refused, or one that never got an answer (`status` 0). */
export class ConnectionRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
  ) {
    super(`monitor connection request failed (${status}${code ? ` ${code}` : ''})`);
  }
}

const BASE = '/api/monitor-connections';

async function request(
  path: string,
  init: { method: 'GET' | 'PUT' | 'POST' | 'DELETE'; body?: unknown },
): Promise<ConnectionSnapshot> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: init.method,
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        ...(init.method === 'GET'
          ? {}
          : {
              'Content-Type': 'application/json',
              'X-Agboard-Token': readToken(),
              'X-Agboard-Language': i18n.resolvedLanguage === 'ja' ? 'ja' : 'en',
            }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new ConnectionRequestError(0, null);
  }
  if (!response.ok) {
    let code: string | null = null;
    try {
      code = ((await response.json()) as { error?: { code?: string } }).error?.code ?? null;
    } catch {
      // The body was not JSON.
    }
    throw new ConnectionRequestError(response.status, code);
  }
  return (await response.json()) as ConnectionSnapshot;
}

export const getConnection = () => request(BASE, { method: 'GET' });

export interface SettingsInput {
  enabled: boolean;
  domain: string | null;
  revision: number;
}

export const saveSettings = (input: SettingsInput) =>
  request(`${BASE}/settings/ngrok`, { method: 'PUT', body: input });

/**
 * The token goes in the body of this one request and is never stored by the page. `save` asks
 * the server to keep it in the OS keychain; it is sent only together with a token.
 */
export const startConnection = (token: string | null, save = false) =>
  request(`${BASE}/transports/ngrok/start`, {
    method: 'POST',
    body: token ? (save ? { token, save: true } : { token }) : undefined,
  });

export const stopConnection = () => request(`${BASE}/transports/ngrok/stop`, { method: 'POST' });

/** Deletes the token saved in the keychain; a connection that is running is not touched. */
export const deleteSavedToken = () => request(`${BASE}/token`, { method: 'DELETE', body: {} });
