import { afterEach, describe, expect, it, vi } from 'vitest';
import { monitorPreferences } from '../../src/pages/monitor/preferences';
import { currentCsrf, forgetCsrf } from '../../src/pages/monitor/session';
import { resetPreferenceOrdering, savePreferences } from '../../src/shared/preferences';
import { jsonResponse } from '../fakes';

const saved = { locale: 'ja', theme: { mode: 'dark', accent: 'teal' }, revision: 1 };

afterEach(() => {
  resetPreferenceOrdering();
  forgetCsrf();
  vi.unstubAllGlobals();
});

describe('monitorPreferences', () => {
  it('opens the session for its CSRF token, then saves with the X-Agboard-Csrf header', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        return url === '/monitor/api/session'
          ? jsonResponse({ csrfToken: 'csrf-7', expiresAt: 1, expiresInSeconds: 60 })
          : jsonResponse(saved);
      }),
    );
    await savePreferences(monitorPreferences, { locale: 'ja' });
    const put = calls.find((call) => call.init?.method === 'PUT');
    expect(put?.url).toBe('/monitor/api/preferences');
    const headers = new Headers(put?.init?.headers);
    expect(headers.get('X-Agboard-Csrf')).toBe('csrf-7');
    expect(headers.get('X-Agboard-Token')).toBeNull();
  });

  it('drops the CSRF token after a 403 so the next save requests a new one', async () => {
    let tokens = 0;
    const csrfSent: (string | null)[] = [];
    let refuse = true;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === '/monitor/api/session') {
          tokens += 1;
          return jsonResponse({ csrfToken: `csrf-${tokens}`, expiresAt: 1, expiresInSeconds: 60 });
        }
        csrfSent.push(new Headers(init?.headers).get('X-Agboard-Csrf'));
        if (refuse) {
          refuse = false;
          return jsonResponse({ code: 'csrf_invalid' }, 403);
        }
        return jsonResponse(saved);
      }),
    );
    await expect(savePreferences(monitorPreferences, { locale: 'ja' })).rejects.toMatchObject({
      status: 403,
    });
    expect(currentCsrf()).toBeNull();
    await savePreferences(monitorPreferences, { locale: 'ja' });
    expect(csrfSent).toEqual(['csrf-1', 'csrf-2']);
  });
});
