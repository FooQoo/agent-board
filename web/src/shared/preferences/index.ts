//! The saved language and color theme. The PC server holds the saved value
//! (`GET`/`PUT /api/preferences`); the browser keeps a copy only so that the
//! first paint can use it before the server answers.

import { applyLocale, cacheLocale, isLocale, type Locale } from '../i18n';
import {
  ACCENTS,
  applyTheme,
  cacheTheme,
  MODES,
  type Accent,
  type Mode,
  type Theme,
} from '../theme';

export interface Preferences {
  locale: Locale;
  theme: Theme;
  revision: number;
}

/** What a save changes. A field left out keeps its saved value. */
export interface PreferencesPatch {
  locale?: Locale;
  theme?: Theme;
}

/** Where the preferences are read and written, and the token that a write sends. */
export interface PreferencesEndpoint {
  url: string;
  token?: () => string;
}

/** A failed read or save. `status` is 0 when the request never got an answer. */
export class PreferencesError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
  ) {
    super(message);
  }
}

function isMode(value: unknown): value is Mode {
  return typeof value === 'string' && (MODES as readonly string[]).includes(value);
}

function isAccent(value: unknown): value is Accent {
  return typeof value === 'string' && (ACCENTS as readonly string[]).includes(value);
}

/** Checks the shape the server sends. Anything else is null, never a partial value. */
export function parsePreferences(value: unknown): Preferences | null {
  if (typeof value !== 'object' || value === null) return null;
  const { locale, theme, revision } = value as Record<string, unknown>;
  if (typeof locale !== 'string' || !isLocale(locale)) return null;
  if (typeof theme !== 'object' || theme === null) return null;
  const { mode, accent } = theme as Record<string, unknown>;
  if (!isMode(mode) || !isAccent(accent)) return null;
  if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 0) return null;
  return { locale, theme: { mode, accent }, revision };
}

/** Reads a `preferences` event's data. Invalid JSON or an unknown shape is null. */
export function parsePreferenceEvent(data: string): Preferences | null {
  try {
    return parsePreferences(JSON.parse(data));
  } catch {
    return null;
  }
}

async function failure(response: Response): Promise<PreferencesError> {
  const body: unknown = await response.json().catch(() => null);
  const code =
    typeof body === 'object' &&
    body !== null &&
    typeof (body as { code?: unknown }).code === 'string'
      ? (body as { code: string }).code
      : null;
  return new PreferencesError(`request failed with ${response.status}`, response.status, code);
}

export async function loadPreferences(
  endpoint: PreferencesEndpoint,
  fetcher: typeof fetch = fetch,
): Promise<Preferences> {
  let response: Response;
  try {
    response = await fetcher(endpoint.url, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
  } catch {
    throw new PreferencesError('network', 0, null);
  }
  if (!response.ok) throw await failure(response);
  const parsed = parsePreferences(await response.json().catch(() => null));
  if (!parsed) throw new PreferencesError('invalid response', response.status, null);
  return parsed;
}

export async function savePreferences(
  endpoint: PreferencesEndpoint,
  patch: PreferencesPatch,
  fetcher: typeof fetch = fetch,
): Promise<Preferences> {
  const token = endpoint.token?.() ?? '';
  let response: Response;
  try {
    response = await fetcher(endpoint.url, {
      method: 'PUT',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(token ? { 'X-Agboard-Token': token } : {}),
      },
      body: JSON.stringify(patch),
    });
  } catch {
    throw new PreferencesError('network', 0, null);
  }
  if (!response.ok) throw await failure(response);
  const parsed = parsePreferences(await response.json().catch(() => null));
  if (!parsed) throw new PreferencesError('invalid response', response.status, null);
  return parsed;
}

/**
 * Shows the preferences on this page and keeps the browser's copy in step.
 * Returns false when the copy could not be written; the page still shows them.
 */
export function applyPreferences(prefs: Preferences): boolean {
  applyTheme(prefs.theme);
  applyLocale(prefs.locale);
  const themeCached = cacheTheme(prefs.theme);
  const localeCached = cacheLocale(prefs.locale);
  return themeCached && localeCached;
}
