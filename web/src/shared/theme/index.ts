export const THEME_STORAGE_KEY = 'agboard.theme';
export const MODES = ['light', 'dark'] as const;
export const ACCENTS = [
  'blue',
  'sky',
  'cyan',
  'teal',
  'green',
  'lime',
  'yellow',
  'orange',
  'red',
  'pink',
  'purple',
  'gray',
] as const;
export type Mode = (typeof MODES)[number];
export type Accent = (typeof ACCENTS)[number];
export type Theme = { mode: Mode; accent: Accent };
export type ThemeStorage = Pick<Storage, 'getItem' | 'setItem'>;
export type ThemeStorageProvider = () => ThemeStorage;
export type SelectThemeResult = { theme: Theme; persisted: boolean; error?: unknown };
export const DEFAULT_THEME: Theme = { mode: 'light', accent: 'blue' };

function browserStorage(): Storage {
  return window.localStorage;
}

function isMode(value: unknown): value is Mode {
  return typeof value === 'string' && (MODES as readonly string[]).includes(value);
}

function isAccent(value: unknown): value is Accent {
  return typeof value === 'string' && (ACCENTS as readonly string[]).includes(value);
}

/** Parses a stored value. Anything but two valid fields yields null (never a partial theme). */
function parseTheme(raw: string | null): Theme | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    const { mode, accent } = value as Record<string, unknown>;
    return isMode(mode) && isAccent(accent) ? { mode, accent } : null;
  } catch {
    return null;
  }
}

/** Reads the saved theme; a missing, invalid or unreadable value yields the default as a whole. */
export function readTheme(storageProvider: ThemeStorageProvider = browserStorage): Theme {
  try {
    return parseTheme(storageProvider().getItem(THEME_STORAGE_KEY)) ?? DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

/** Puts a theme on the document now. Nothing is saved; see `selectTheme` and `cacheTheme`. */
export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.mode = theme.mode;
  root.dataset.accent = theme.accent;
  root.classList.toggle('dark', theme.mode === 'dark');
  root.style.colorScheme = theme.mode;
}

/** Applies the saved (or default) theme to the document. Call before the first render. */
export function initializeTheme(storageProvider: ThemeStorageProvider = browserStorage): Theme {
  const theme = readTheme(storageProvider);
  applyTheme(theme);
  return theme;
}

/** Applies the theme to the document first, then tries to save it. A save failure keeps the page theme. */
export function selectTheme(
  theme: Theme,
  storageProvider: ThemeStorageProvider = browserStorage,
): SelectThemeResult {
  applyTheme(theme);
  try {
    storageProvider().setItem(THEME_STORAGE_KEY, JSON.stringify(theme));
    return { theme, persisted: true };
  } catch (error) {
    return { theme, persisted: false, error };
  }
}

/** Writes the browser's copy of the theme, which the first paint uses. Returns false when the write fails. */
export function cacheTheme(
  theme: Theme,
  storageProvider: ThemeStorageProvider = browserStorage,
): boolean {
  try {
    storageProvider().setItem(THEME_STORAGE_KEY, JSON.stringify(theme));
    return true;
  } catch {
    return false;
  }
}
