import { afterEach, describe, expect, it, vi } from 'vitest';
import { authHeaders, csrfHeaders, setCsrfToken } from '../../shared/api/http';
import { onMonitorAuthLoss } from '../../pages/monitor/session';
import { openRemoteSession, unlockRemote, usesRemoteSession, watchSessionLoss } from './session';

function setToken(content: string | null) {
  document.querySelector('meta[name="agboard-token"]')?.remove();
  if (content === null) return;
  const meta = document.createElement('meta');
  meta.name = 'agboard-token';
  meta.content = content;
  document.head.append(meta);
}

const originalFetch = window.fetch;

afterEach(() => {
  setToken(null);
  setCsrfToken('');
  window.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('the credential a write sends', () => {
  it('is the board token on the local page, whatever session state there is', () => {
    setToken('t'.repeat(64));
    setCsrfToken('c'.repeat(64));
    expect(authHeaders()).toEqual({ 'X-Agboard-Token': 't'.repeat(64) });
    expect(csrfHeaders()).toEqual({});
  });

  it('is the session CSRF token on a page without a token, and never the token header', () => {
    setToken('');
    setCsrfToken('c'.repeat(64));
    expect(authHeaders()).toEqual({ 'X-Agboard-Csrf': 'c'.repeat(64) });
    expect(csrfHeaders()).toEqual({ 'X-Agboard-Csrf': 'c'.repeat(64) });
  });

  it('keeps the empty token header before a session exists', () => {
    setToken('');
    expect(authHeaders()).toEqual({ 'X-Agboard-Token': '' });
  });
});

describe('the passcode session', () => {
  it('is used only by a page that carries no token', () => {
    setToken('t'.repeat(64));
    expect(usesRemoteSession()).toBe(false);
    setToken('');
    expect(usesRemoteSession()).toBe(true);
  });

  it('keeps the CSRF token of an accepted passcode, from the board app routes', async () => {
    setToken('');
    const calls: string[] = [];
    window.fetch = vi.fn(async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response(
        JSON.stringify({ csrfToken: 'k'.repeat(64), expiresAt: 10, expiresInSeconds: 5 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    await unlockRemote('1234');
    expect(calls).toEqual(['/api/remote/unlock']);
    expect(authHeaders()).toEqual({ 'X-Agboard-Csrf': 'k'.repeat(64) });
    setCsrfToken('');
    await openRemoteSession();
    expect(calls).toEqual(['/api/remote/unlock', '/api/remote/session']);
    expect(authHeaders()).toEqual({ 'X-Agboard-Csrf': 'k'.repeat(64) });
  });

  it('keeps no CSRF token for a refused passcode', async () => {
    setToken('');
    window.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { code: 'unlock_failed' } }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    await expect(unlockRemote('0000')).rejects.toMatchObject({ code: 'unlock_failed' });
    expect(authHeaders()).toEqual({ 'X-Agboard-Token': '' });
  });

  it('forgets the session and tells the gate when a board request is answered 401', async () => {
    setToken('');
    setCsrfToken('c'.repeat(64));
    window.fetch = vi.fn(async () => new Response('{}', { status: 401 }));
    watchSessionLoss();
    const losses: string[] = [];
    const stop = onMonitorAuthLoss((loss) => losses.push(loss));
    await window.fetch('/api/projects');
    stop();
    expect(losses).toEqual(['session_required']);
    expect(authHeaders()).toEqual({ 'X-Agboard-Token': '' });
  });
});
