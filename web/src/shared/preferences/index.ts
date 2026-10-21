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
  /** Further headers a save sends, such as the monitor's CSRF header. It may open a session first. */
  headers?: () => Record<string, string> | Promise<Record<string, string>>;
  /** Called with the status when a save is refused, so the endpoint can drop a stale credential. */
  onRefused?: (status: number) => void;
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

// Ordering rules. `shownRevision` is the newest server revision this page shows: an older result
// is ignored. `choiceSeq` counts the user's own choices: a choice is shown at once and wins over
// any read or save that started before it.
let shownRevision = -1;
let choiceSeq = 0;

/** Notes a choice of the user (already shown on the page). Returns its sequence number. */
export function markLocalChoice(): number {
  choiceSeq += 1;
  return choiceSeq;
}

/** Forgets the ordering state. For tests. */
export function resetPreferenceOrdering(): void {
  shownRevision = -1;
  choiceSeq = 0;
}

/** Shows server preferences unless the page already shows a newer revision. */
function showIfNewer(prefs: Preferences): boolean {
  if (prefs.revision < shownRevision) return false;
  applyPreferences(prefs);
  return true;
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
  const seq = markLocalChoice();
  const token = endpoint.token?.() ?? '';
  let response: Response;
  try {
    const extra = (await endpoint.headers?.()) ?? {};
    response = await fetcher(endpoint.url, {
      method: 'PUT',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(token ? { 'X-Agboard-Token': token } : {}),
        ...extra,
      },
      body: JSON.stringify(patch),
    });
  } catch {
    throw new PreferencesError('network', 0, null);
  }
  if (!response.ok) {
    endpoint.onRefused?.(response.status);
    throw await failure(response);
  }
  const parsed = parsePreferences(await response.json().catch(() => null));
  if (!parsed) throw new PreferencesError('invalid response', response.status, null);
  // An older save must not replace a newer choice that is on screen.
  if (seq === choiceSeq) showIfNewer(parsed);
  return parsed;
}

/**
 * Shows the preferences on this page and keeps the browser's copy in step.
 * Returns false when the copy could not be written; the page still shows them.
 */
export function applyPreferences(prefs: Preferences): boolean {
  shownRevision = Math.max(shownRevision, prefs.revision);
  applyTheme(prefs.theme);
  applyLocale(prefs.locale);
  const themeCached = cacheTheme(prefs.theme);
  const localeCached = cacheLocale(prefs.locale);
  return themeCached && localeCached;
}

/**
 * Startup: reads the saved preferences and shows them when they are there. A failed read keeps
 * the page as the browser copy painted it. Returns the saved value, or null when none was read.
 */
export async function syncPreferences(
  endpoint: PreferencesEndpoint,
  fetcher: typeof fetch = fetch,
): Promise<Preferences | null> {
  const seq = choiceSeq;
  try {
    const prefs = await loadPreferences(endpoint, fetcher);
    // The user chose something while this read was in flight: the choice wins.
    if (seq === choiceSeq) showIfNewer(prefs);
    return prefs;
  } catch {
    return null;
  }
}

/** Applies a `preferences` event from an event stream. Data that is not preferences is ignored. */
export function applyPreferenceEvent(event: Event): void {
  const data = (event as MessageEvent).data;
  if (typeof data !== 'string') return;
  const prefs = parsePreferenceEvent(data);
  if (prefs) showIfNewer(prefs);
}
