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
    /** The saved ngrok domain, or null when none is saved (ngrok then chooses the address). */
    domain: string | null;
  };
  /** The domain from the AGBOARD_NGROK_DOMAIN environment variable; when set, it is the one used. */
  domainEnv: string | null;
  /** Whether a token is available: from the environment, this PC's secure storage or this run. */
  tokenConfigured: boolean;
  /** Where the token in use comes from; the value itself is never sent. */
  tokenSource: TokenSource | null;
  /** Whether this PC has a secure storage (the OS keychain) that can hold a token. */
  keychainAvailable: boolean;
  /** Whether a token is saved in this PC's secure storage. */
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

/** A phone or browser registered with the passcode. Never carries the device token. */
export interface RegisteredDevice {
  id: string;
  /** A short name made from the browser's User-Agent, such as "iPhone / Safari". */
  label: string;
  /** RFC 3339 times. */
  createdAt: string;
  lastSeenAt: string;
}

async function request<T = ConnectionSnapshot>(
  path: string,
  init: { method: 'GET' | 'PUT' | 'POST' | 'DELETE'; body?: unknown },
): Promise<T> {
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
  return (await response.json()) as T;
}

export const getConnection = () => request(BASE, { method: 'GET' });

export interface SettingsInput {
  enabled: boolean;
  revision: number;
  /** A host name to save; an empty string clears it; left out, the saved one is kept. */
  domain?: string;
}

export const saveSettings = (input: SettingsInput) =>
  request(`${BASE}/settings/ngrok`, { method: 'PUT', body: input });

/**
 * The token goes in the body of this one request and is never stored by the page. `save` asks
 * the server to keep it in this PC's secure storage; it is sent only together with a token.
 */
export const startConnection = (token: string | null, save = false) =>
  request(`${BASE}/transports/ngrok/start`, {
    method: 'POST',
    body: token ? (save ? { token, save: true } : { token }) : undefined,
  });

export const stopConnection = () => request(`${BASE}/transports/ngrok/stop`, { method: 'POST' });

/** Deletes the token saved in the secure storage; a connection that is running is not touched. */
export const deleteSavedToken = () => request(`${BASE}/token`, { method: 'DELETE', body: {} });

/** The registered devices, the one used last first. */
export const getDevices = async () =>
  (await request<{ devices: RegisteredDevice[] }>(`${BASE}/devices`, { method: 'GET' })).devices;

/** Unregisters a device: its live sessions end at once. Resolves to the devices that are left. */
export const removeDevice = async (id: string) =>
  (
    await request<{ devices: RegisteredDevice[] }>(`${BASE}/devices/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      body: {},
    })
  ).devices;
