import { afterEach, describe, expect, it, vi } from 'vitest';

const PROJECT_ID = 'a'.repeat(32);

afterEach(() => vi.unstubAllGlobals());

describe('monitor read client', () => {
  it('uses only fixed /monitor/api/ GET routes for catalog, board, epic and assets', async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ projects: [], catalogVersion: 'v1', epics: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { monitorClient, monitorReadResolvers } = await import('../../src/pages/monitor/client');

    await monitorClient.fetchCatalog();
    await monitorClient.fetchBoard(PROJECT_ID);
    await monitorReadResolvers.getEpics(PROJECT_ID);
    expect(monitorReadResolvers.attachmentUrl(PROJECT_ID, 4, 'b'.repeat(32))).toBe(
      `/monitor/api/projects/${PROJECT_ID}/tasks/4/attachments/${'b'.repeat(32)}`,
    );
    expect(monitorReadResolvers.epicAttachmentUrl(PROJECT_ID, 'ABC-1', 'b'.repeat(32))).toBe(
      `/monitor/api/projects/${PROJECT_ID}/epics/ABC-1/attachments/${'b'.repeat(32)}`,
    );
    for (const [input, init] of vi.mocked(fetchMock).mock.calls) {
      expect(String(input)).toMatch(/^\/monitor\/api\//);
      expect(init?.method).toBeUndefined();
      expect(init?.headers).toEqual({ Accept: 'application/json' });
    }
  });

  it('rejects unsafe path segments before making a request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { monitorClient, monitorReadResolvers } = await import('../../src/pages/monitor/client');
    expect(() => monitorClient.fetchBoard('../api')).toThrow(/project/i);
    expect(() => monitorReadResolvers.attachmentUrl(PROJECT_ID, 0, 'x')).toThrow(/task/i);
    expect(() => monitorReadResolvers.epicAttachmentUrl(PROJECT_ID, '../', 'b'.repeat(32))).toThrow(
      /epic/i,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('exposes the API code, reason and status from the current error response shape', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: { code: 'project_not_found', message: 'missing', reason: 'gone' },
            }),
            {
              status: 404,
              headers: { 'Content-Type': 'application/json' },
            },
          ),
      ),
    );
    const { monitorClient, MonitorClientError } = await import('../../src/pages/monitor/client');
    await expect(monitorClient.fetchBoard(PROJECT_ID)).rejects.toMatchObject({
      name: 'MonitorClientError',
      status: 404,
      code: 'project_not_found',
      reason: 'gone',
    } satisfies Partial<InstanceType<typeof MonitorClientError>>);
  });

  it('aborts a request after the injected timeout', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { monitorClient } = await import('../../src/pages/monitor/client');
    const request = monitorClient.fetchCatalog({ timeoutMs: 100 });
    const rejection = expect(request).rejects.toMatchObject({ code: 'timeout', status: 0 });
    await vi.advanceTimersByTimeAsync(101);
    await rejection;
    vi.useRealTimers();
  });
});

describe('monitor answer client', () => {
  it('uses the monitor token and only the fixed answer POST route', async () => {
    document.head.innerHTML = '<meta name="agboard-monitor-token" content="monitor-secret">';
    const task = { id: 7, title: 'Decision', pendingRequestId: null };
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ task, changed: true }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { monitorClient } = await import('../../src/pages/monitor/client');

    await expect(
      monitorClient.answerRequest(PROJECT_ID, 7, { requestId: 'request-7', choiceId: 'yes' }),
    ).resolves.toEqual({ task, changed: true });
    expect(fetchMock).toHaveBeenCalledWith(
      `/monitor/api/projects/${PROJECT_ID}/tasks/7/answer`,
      expect.objectContaining({
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-Agboard-Token': 'monitor-secret',
          'X-Agboard-Language': 'en',
        },
        body: JSON.stringify({ requestId: 'request-7', choiceId: 'yes' }),
      }),
    );
  });

  it('preserves write codes and status for changed requests and stale page tokens', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: { code: 'page_out_of_date', reason: 'reload', message: 'stale' },
          }),
          { status: 403 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { monitorClient } = await import('../../src/pages/monitor/client');
    await expect(
      monitorClient.answerRequest(PROJECT_ID, 7, { requestId: 'request-7', text: 'answer' }),
    ).rejects.toMatchObject({ status: 403, code: 'page_out_of_date' });
  });
});

describe('monitor session client', () => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  it('sends the CSRF token, not a monitor token, once the page has no token', async () => {
    document.head.innerHTML = '<meta name="agboard-monitor-token" content="">';
    const task = { id: 7, title: 'Decision', pendingRequestId: null };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) =>
      String(input).endsWith('/session')
        ? json({ csrfToken: 'csrf-1', expiresAt: 10, expiresInSeconds: 5 })
        : json({ task, changed: true }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { monitorClient } = await import('../../src/pages/monitor/client');
    await monitorClient.answerRequest(PROJECT_ID, 7, { requestId: 'r', choiceId: 'yes' });
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      '/monitor/api/session',
      `/monitor/api/projects/${PROJECT_ID}/tasks/7/answer`,
    ]);
    const headers = fetchMock.mock.calls[1]?.[1]?.headers as Record<string, string>;
    expect(headers['X-Agboard-Csrf']).toBe('csrf-1');
    expect(headers).not.toHaveProperty('X-Agboard-Token');
  });

  it('reports a session_required read and a sign-in page as a lost connection', async () => {
    document.head.innerHTML = '<meta name="agboard-monitor-token" content="">';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ error: { code: 'session_required' } }, 401))
      .mockResolvedValueOnce(new Response('<html>Sign in</html>', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { monitorClient, onMonitorAuthLoss } = await import('../../src/pages/monitor/client');
    const seen: string[] = [];
    const off = onMonitorAuthLoss((loss) => seen.push(loss));
    await expect(monitorClient.fetchCatalog()).rejects.toMatchObject({ code: 'session_required' });
    await expect(monitorClient.fetchCatalog()).rejects.toMatchObject({ code: 'auth_redirect' });
    off();
    expect(seen).toEqual(['session_required', 'auth_redirect']);
  });

  it('does not report a lost connection for a page that has a token', async () => {
    document.head.innerHTML = '<meta name="agboard-monitor-token" content="t">';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ error: { code: 'session_required' } }, 401)),
    );
    const { monitorClient, onMonitorAuthLoss } = await import('../../src/pages/monitor/client');
    const listener = vi.fn();
    const off = onMonitorAuthLoss(listener);
    await expect(monitorClient.fetchCatalog()).rejects.toMatchObject({ status: 401 });
    off();
    expect(listener).not.toHaveBeenCalled();
  });
});
