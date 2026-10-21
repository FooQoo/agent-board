// The monitor's access to the saved language and theme, through the ngrok entrance.

import type { PreferencesEndpoint } from '../../shared/preferences';
import {
  MONITOR_API_BASE,
  currentCsrf,
  forgetCsrf,
  openSession,
  readMonitorToken,
  usesMonitorSession,
} from './session';

/**
 * A save sends the CSRF header of the app session (the page opens the session first when it has
 * no token yet), or the page's token when it came without a session.
 */
export const monitorPreferences: PreferencesEndpoint = {
  url: `${MONITOR_API_BASE}preferences`,
  headers: async (): Promise<Record<string, string>> => {
    if (!usesMonitorSession()) return { 'X-Agboard-Token': readMonitorToken() };
    if (currentCsrf() === null) await openSession();
    return { 'X-Agboard-Csrf': currentCsrf() ?? '' };
  },
  // A refused save may mean the CSRF token is stale; the next save fetches a new one.
  onRefused: (status) => {
    if (status === 403 && usesMonitorSession()) forgetCsrf();
  },
};
