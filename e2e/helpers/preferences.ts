import { mainOrigin } from './agboard';

export type Locale = 'en' | 'ja';
export type Mode = 'light' | 'dark';
export type Accent =
  | 'blue' | 'sky' | 'cyan' | 'teal' | 'green' | 'lime'
  | 'yellow' | 'orange' | 'red' | 'pink' | 'purple' | 'gray';

export interface PreferencesPatch {
  locale?: Locale;
  theme?: { mode: Mode; accent: Accent };
}

export interface SavedPreferences {
  locale: Locale;
  theme: { mode: Mode; accent: Accent };
  revision: number;
}

/** What the server shows when nothing was saved. */
export const defaultPreferences = { locale: 'en', theme: { mode: 'light', accent: 'blue' } } as const;

/** The write token the server puts in the page it serves. */
async function pageToken(origin: string): Promise<string> {
  const html = await (await fetch(`${origin}/`)).text();
  const token = html.match(/<meta name="agboard-token" content="([^"]*)"/)?.[1];
  if (!token) throw new Error(`no write token in the page at ${origin}`);
  return token;
}

/**
 * Save the language and/or the color theme the way the settings screen does: `PUT /api/preferences`
 * on the PC entrance, with the page's token and same-origin headers. Returns the saved value.
 */
export async function setPreferences(patch: PreferencesPatch, origin: string = mainOrigin): Promise<SavedPreferences> {
  const response = await fetch(`${origin}/api/preferences`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Origin: origin,
      'Sec-Fetch-Site': 'same-origin',
      'X-Agboard-Token': await pageToken(origin),
    },
    body: JSON.stringify(patch),
  });
  if (!response.ok) throw new Error(`PUT /api/preferences answered ${response.status}: ${await response.text()}`);
  return (await response.json()) as SavedPreferences;
}

/** Put the language and theme back to the defaults so that no value leaks into the next spec. */
export function resetPreferences(origin: string = mainOrigin): Promise<SavedPreferences> {
  return setPreferences(defaultPreferences, origin);
}

/** The saved preferences, as `GET /api/preferences` answers. */
export async function getPreferences(origin: string = mainOrigin): Promise<SavedPreferences> {
  const response = await fetch(`${origin}/api/preferences`);
  if (!response.ok) throw new Error(`GET /api/preferences answered ${response.status}`);
  return (await response.json()) as SavedPreferences;
}
