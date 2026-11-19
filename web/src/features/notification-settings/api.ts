import { authHeaders } from '../../shared/api/http';
import {
  parseNotificationSettings,
  type NotificationSettings,
  type NotificationSettingsPatch,
} from './model';

const URL = '/api/notification-settings';

/** A failed read or save. `status` is 0 when the request never got an answer. */
export class NotificationSettingsError extends Error {
  constructor(readonly status: number) {
    super(`notification settings request failed (${status})`);
  }
}

async function parse(response: Response): Promise<NotificationSettings> {
  if (!response.ok) throw new NotificationSettingsError(response.status);
  const settings = parseNotificationSettings(await response.json().catch(() => null));
  if (!settings) throw new NotificationSettingsError(response.status);
  return settings;
}

/** The saved settings. Served on the PC and through the remote entrance. */
export async function loadNotificationSettings(
  fetcher: typeof fetch = fetch,
): Promise<NotificationSettings> {
  let response: Response;
  try {
    response = await fetcher(URL, { cache: 'no-store', headers: { Accept: 'application/json' } });
  } catch {
    throw new NotificationSettingsError(0);
  }
  return parse(response);
}

/** Saves the groups in `patch` and returns the whole saved value. */
export async function saveNotificationSettings(
  patch: NotificationSettingsPatch,
  fetcher: typeof fetch = fetch,
): Promise<NotificationSettings> {
  let response: Response;
  try {
    response = await fetcher(URL, {
      method: 'PUT',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...authHeaders(),
      },
      body: JSON.stringify(patch),
    });
  } catch {
    throw new NotificationSettingsError(0);
  }
  return parse(response);
}
