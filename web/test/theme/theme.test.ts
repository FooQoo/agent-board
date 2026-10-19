import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ACCENTS,
  DEFAULT_THEME,
  initializeTheme,
  MODES,
  readTheme,
  selectTheme,
  THEME_STORAGE_KEY,
  type Theme,
  type ThemeStorage,
} from '../../src/shared/theme';

function memoryStorage(initial?: string): ThemeStorage & { value: string | null } {
  const store = { value: initial ?? null };
  return {
    get value() {
      return store.value;
    },
    getItem: (key: string) => (key === THEME_STORAGE_KEY ? store.value : null),
    setItem: (key: string, value: string) => {
      if (key === THEME_STORAGE_KEY) store.value = value;
    },
  } as ThemeStorage & { value: string | null };
}

const all: Theme[] = MODES.flatMap((mode) => ACCENTS.map((accent) => ({ mode, accent })));
const root = document.documentElement;

function resetDom() {
  root.removeAttribute('data-mode');
  root.removeAttribute('data-accent');
  root.classList.remove('dark');
  root.style.colorScheme = '';
}

beforeEach(resetDom);
afterEach(() => vi.restoreAllMocks());

describe('theme catalog', () => {
  it('has 12 accents in the fixed order and 24 themes', () => {
    expect(ACCENTS).toEqual([
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
    ]);
    expect(MODES).toEqual(['light', 'dark']);
    expect(all).toHaveLength(24);
    expect(DEFAULT_THEME).toEqual({ mode: 'light', accent: 'blue' });
    expect(THEME_STORAGE_KEY).toBe('agboard.theme');
  });
});

describe('readTheme', () => {
  it.each(all)('reads the saved theme $mode/$accent', (theme) => {
    expect(readTheme(() => memoryStorage(JSON.stringify(theme)))).toEqual(theme);
  });

  it.each([
    ['missing', undefined],
    ['invalid JSON', '{nope'],
    ['not an object', '"dark"'],
    ['null', 'null'],
    ['unknown mode', '{"mode":"auto","accent":"blue"}'],
    ['unknown accent', '{"mode":"dark","accent":"magenta"}'],
    ['missing accent', '{"mode":"dark"}'],
    ['missing mode', '{"accent":"red"}'],
    ['wrong types', '{"mode":1,"accent":2}'],
  ])('returns the whole default for %s', (_name, raw) => {
    expect(readTheme(() => memoryStorage(raw))).toEqual(DEFAULT_THEME);
  });

  it('does not mix a valid half with the default', () => {
    expect(readTheme(() => memoryStorage('{"mode":"dark","accent":"x"}'))).toEqual({
      mode: 'light',
      accent: 'blue',
    });
  });

  it('returns the default when getItem throws', () => {
    const storage = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {},
    };
    expect(readTheme(() => storage)).toEqual(DEFAULT_THEME);
  });

  it('returns the default when obtaining the storage throws', () => {
    expect(
      readTheme(() => {
        throw new Error('blocked');
      }),
    ).toEqual(DEFAULT_THEME);
  });

  it('does not consult the OS color scheme', () => {
    const matchMedia = vi.fn();
    vi.stubGlobal('matchMedia', matchMedia);
    expect(readTheme(() => memoryStorage())).toEqual(DEFAULT_THEME);
    initializeTheme(() => memoryStorage());
    expect(matchMedia).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe('initializeTheme', () => {
  it.each(all)('applies $mode/$accent to the document', (theme) => {
    initializeTheme(() => memoryStorage(JSON.stringify(theme)));
    expect(root.dataset.mode).toBe(theme.mode);
    expect(root.dataset.accent).toBe(theme.accent);
    expect(root.classList.contains('dark')).toBe(theme.mode === 'dark');
    expect(root.style.colorScheme).toBe(theme.mode);
  });

  it('applies the default for invalid storage and returns it', () => {
    expect(initializeTheme(() => memoryStorage('garbage'))).toEqual(DEFAULT_THEME);
    expect(root.dataset.mode).toBe('light');
    expect(root.dataset.accent).toBe('blue');
    expect(root.classList.contains('dark')).toBe(false);
  });

  it('can be re-initialized and clears the previous dark class', () => {
    initializeTheme(() => memoryStorage('{"mode":"dark","accent":"red"}'));
    expect(root.classList.contains('dark')).toBe(true);
    initializeTheme(() => memoryStorage('{"mode":"light","accent":"pink"}'));
    expect(root.classList.contains('dark')).toBe(false);
    expect(root.dataset.accent).toBe('pink');
    expect(root.style.colorScheme).toBe('light');
  });

  it('works with the default browser storage', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, '{"mode":"dark","accent":"teal"}');
    expect(initializeTheme()).toEqual({ mode: 'dark', accent: 'teal' });
    window.localStorage.removeItem(THEME_STORAGE_KEY);
  });
});

describe('selectTheme', () => {
  it('applies to the DOM and persists as JSON', () => {
    const storage = memoryStorage();
    const result = selectTheme({ mode: 'dark', accent: 'purple' }, () => storage);
    expect(result).toEqual({ theme: { mode: 'dark', accent: 'purple' }, persisted: true });
    expect(root.dataset.mode).toBe('dark');
    expect(root.dataset.accent).toBe('purple');
    expect(root.classList.contains('dark')).toBe(true);
    expect(root.style.colorScheme).toBe('dark');
    expect(JSON.parse(storage.value ?? 'null')).toEqual({ mode: 'dark', accent: 'purple' });
    expect(readTheme(() => storage)).toEqual({ mode: 'dark', accent: 'purple' });
  });

  it('keeps the selection on the page when setItem throws', () => {
    const error = new Error('quota');
    const storage = {
      getItem: () => null,
      setItem: () => {
        throw error;
      },
    };
    const result = selectTheme({ mode: 'dark', accent: 'orange' }, () => storage);
    expect(result.persisted).toBe(false);
    expect(result.error).toBe(error);
    expect(result.theme).toEqual({ mode: 'dark', accent: 'orange' });
    expect(root.dataset.accent).toBe('orange');
    expect(root.classList.contains('dark')).toBe(true);
  });

  it('keeps the selection on the page when obtaining the storage throws', () => {
    const result = selectTheme({ mode: 'light', accent: 'lime' }, () => {
      throw new Error('blocked');
    });
    expect(result.persisted).toBe(false);
    expect(result.error).toBeInstanceOf(Error);
    expect(root.dataset.accent).toBe('lime');
  });

  it('applies to the DOM before saving', () => {
    let seenAtSave: string | undefined;
    const storage = {
      getItem: () => null,
      setItem: () => {
        seenAtSave = root.dataset.accent;
      },
    };
    selectTheme({ mode: 'light', accent: 'cyan' }, () => storage);
    expect(seenAtSave).toBe('cyan');
  });

  it('does not change the locale key', () => {
    window.localStorage.setItem('agboard.locale', 'ja');
    selectTheme({ mode: 'dark', accent: 'gray' });
    expect(window.localStorage.getItem('agboard.locale')).toBe('ja');
    window.localStorage.clear();
  });
});
