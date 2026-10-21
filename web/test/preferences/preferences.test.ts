import { afterEach, describe, expect, it } from 'vitest';
import {
  applyPreferences,
  loadPreferences,
  parsePreferenceEvent,
  parsePreferences,
  PreferencesError,
  type Preferences,
  savePreferences,
} from '../../src/shared/preferences';
import { LOCALE_STORAGE_KEY } from '../../src/shared/i18n';
import { THEME_STORAGE_KEY } from '../../src/shared/theme';

const saved: Preferences = {
  locale: 'ja',
  theme: { mode: 'dark', accent: 'teal' },
  revision: 3,
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-mode');
  document.documentElement.removeAttribute('data-accent');
  document.documentElement.removeAttribute('lang');
});

describe('parsePreferences', () => {
  it('accepts the shape the server sends', () => {
    expect(parsePreferences(saved)).toEqual(saved);
  });

  it('rejects an unknown locale, mode, accent, or a bad revision as a whole', () => {
    expect(parsePreferences({ ...saved, locale: 'fr' })).toBeNull();
    expect(parsePreferences({ ...saved, theme: { mode: 'neon', accent: 'teal' } })).toBeNull();
    expect(parsePreferences({ ...saved, theme: { mode: 'dark', accent: 'magenta' } })).toBeNull();
    expect(parsePreferences({ ...saved, revision: -1 })).toBeNull();
    expect(parsePreferences({ ...saved, revision: 1.5 })).toBeNull();
    expect(parsePreferences(null)).toBeNull();
  });
});

describe('parsePreferenceEvent', () => {
  it('reads the data of a preferences event', () => {
    expect(parsePreferenceEvent(JSON.stringify(saved))).toEqual(saved);
  });

  it('returns null for broken JSON or a different shape', () => {
    expect(parsePreferenceEvent('{ nope')).toBeNull();
    expect(parsePreferenceEvent('{}')).toBeNull();
  });
});

describe('loadPreferences', () => {
  it('reads the saved value from the endpoint without caching it', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetcher = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return jsonResponse(200, saved);
    }) as typeof fetch;
    await expect(loadPreferences({ url: '/api/preferences' }, fetcher)).resolves.toEqual(saved);
    const [first] = calls;
    expect(first?.url).toBe('/api/preferences');
    expect(first?.init?.cache).toBe('no-store');
  });

  it('throws a PreferencesError with the status and code of a failed read', async () => {
    const fetcher = (async () =>
      jsonResponse(500, { code: 'preferences_unavailable' })) as typeof fetch;
    await expect(loadPreferences({ url: '/api/preferences' }, fetcher)).rejects.toMatchObject({
      status: 500,
      code: 'preferences_unavailable',
    });
  });

  it('reports a network failure as status 0', async () => {
    const fetcher = (async () => {
      throw new TypeError('offline');
    }) as typeof fetch;
    const error = await loadPreferences({ url: '/api/preferences' }, fetcher).catch((e) => e);
    expect(error).toBeInstanceOf(PreferencesError);
    expect(error.status).toBe(0);
  });

  it('rejects a body that is not a preferences value', async () => {
    const fetcher = (async () => jsonResponse(200, { locale: 'fr' })) as typeof fetch;
    await expect(loadPreferences({ url: '/api/preferences' }, fetcher)).rejects.toBeInstanceOf(
      PreferencesError,
    );
  });
});

describe('savePreferences', () => {
  it('sends only the patch, with the write token when one is given', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetcher = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return jsonResponse(200, { ...saved, revision: 4 });
    }) as typeof fetch;
    const result = await savePreferences(
      { url: '/api/preferences', token: () => 'secret' },
      { locale: 'ja' },
      fetcher,
    );
    expect(result.revision).toBe(4);
    const init = calls[0]?.init as RequestInit;
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual({ locale: 'ja' });
    expect((init.headers as Record<string, string>)['X-Agboard-Token']).toBe('secret');
  });

  it('omits the token header when there is no token', async () => {
    let headers: Record<string, string> = {};
    const fetcher = (async (_url: string, init?: RequestInit) => {
      headers = init?.headers as Record<string, string>;
      return jsonResponse(200, saved);
    }) as typeof fetch;
    await savePreferences({ url: '/monitor/api/preferences' }, { theme: saved.theme }, fetcher);
    expect(headers).not.toHaveProperty('X-Agboard-Token');
  });

  it('keeps the server code of a refused save', async () => {
    const fetcher = (async () =>
      jsonResponse(422, { code: 'invalid_preferences' })) as typeof fetch;
    await expect(
      savePreferences({ url: '/api/preferences' }, { locale: 'fr' } as never, fetcher),
    ).rejects.toMatchObject({ status: 422, code: 'invalid_preferences' });
  });
});

describe('applyPreferences', () => {
  it('shows the preferences on the page and keeps the browser copy in step', () => {
    expect(applyPreferences(saved)).toBe(true);
    expect(document.documentElement.dataset.mode).toBe('dark');
    expect(document.documentElement.dataset.accent).toBe('teal');
    expect(document.documentElement.lang).toBe('ja');
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('ja');
    expect(JSON.parse(localStorage.getItem(THEME_STORAGE_KEY) ?? 'null')).toEqual(saved.theme);
  });

  it('still shows the preferences when the browser copy cannot be written', () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error('quota');
    };
    try {
      expect(applyPreferences(saved)).toBe(false);
      expect(document.documentElement.dataset.accent).toBe('teal');
    } finally {
      Storage.prototype.setItem = original;
    }
  });
});
