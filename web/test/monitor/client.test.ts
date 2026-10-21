import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

  it('reports a session_required read and a page that is not the monitor as a lost connection', async () => {
    document.head.innerHTML = '<meta name="agboard-monitor-token" content="">';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ error: { code: 'session_required' } }, 401))
      .mockResolvedValueOnce(new Response('<html>Some other page</html>', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { monitorClient, onMonitorAuthLoss } = await import('../../src/pages/monitor/client');
    const seen: string[] = [];
    const off = onMonitorAuthLoss((loss) => seen.push(loss));
    await expect(monitorClient.fetchCatalog()).rejects.toMatchObject({ code: 'session_required' });
    await expect(monitorClient.fetchCatalog()).rejects.toMatchObject({
      code: 'unexpected_response',
    });
    off();
    expect(seen).toEqual(['session_required', 'unexpected_response']);
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

describe('monitor passcode client', () => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const session = { csrfToken: 'csrf-9', expiresAt: 10, expiresInSeconds: 5 };

  beforeEach(() => {
    vi.resetModules();
    document.head.innerHTML = '<meta name="agboard-monitor-token" content="">';
  });

  it('asks for a session without starting one, and a missing session is session_required', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      json({ error: { code: 'session_required' } }, 401),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { monitorClient, onMonitorAuthLoss } = await import('../../src/pages/monitor/client');
    const { currentCsrf } = await import('../../src/pages/monitor/session');
    const seen: string[] = [];
    const off = onMonitorAuthLoss((loss) => seen.push(loss));
    await expect(monitorClient.openSession()).rejects.toMatchObject({
      status: 401,
      code: 'session_required',
    });
    off();
    // The hook asks the session itself, so asking is not reported as a loss.
    expect(seen).toEqual([]);
    expect(currentCsrf()).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe('/monitor/api/session');
    expect(init?.method).toBeUndefined();
  });

  it('sends the passcode as JSON to unlock and keeps only the CSRF token', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      json(session),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { monitorClient } = await import('../../src/pages/monitor/client');
    const { currentCsrf } = await import('../../src/pages/monitor/session');
    await expect(monitorClient.unlock('0482')).resolves.toEqual(session);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe('/monitor/api/unlock');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({
      Accept: 'application/json',
      'Content-Type': 'application/json',
    });
    // The digits stay a string: a leading zero survives.
    expect(init?.body).toBe('{"code":"0482"}');
    expect(init?.redirect).toBe('manual');
    expect(currentCsrf()).toBe('csrf-9');
  });

  it('tells a wrong passcode, a locked monitor and a monitor that is not available apart', async () => {
    const answers = [
      json({ error: { code: 'unlock_failed' } }, 403),
      json({ error: { code: 'unlock_locked' } }, 429),
      json({ error: { code: 'forbidden' } }, 403),
      json({}, 500),
      new Response('<html>Not the monitor</html>', { status: 200 }),
      new Response(null, { status: 302 }),
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => answers.shift() as Response),
    );
    const { monitorClient } = await import('../../src/pages/monitor/client');
    const { currentCsrf } = await import('../../src/pages/monitor/session');
    const codes: (string | null)[] = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await monitorClient.unlock('1234').then(
        () => codes.push('accepted'),
        (cause) => codes.push((cause as { code: string | null }).code),
      );
    }
    expect(codes).toEqual([
      'unlock_failed',
      'unlock_locked',
      'unavailable',
      'server_error',
      'unexpected_response',
      'unexpected_response',
    ]);
    expect(currentCsrf()).toBeNull();
  });

  it('reports a network failure and a timeout without a status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const { monitorClient } = await import('../../src/pages/monitor/client');
    await expect(monitorClient.unlock('1234')).rejects.toMatchObject({
      status: 0,
      code: 'network_error',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('x', 'AbortError')),
            );
          }),
      ),
    );
    await expect(monitorClient.unlock('1234', { timeoutMs: 20 })).rejects.toMatchObject({
      code: 'timeout',
    });
  });

  it('answers with the CSRF token an unlock gave, without asking for a session again', async () => {
    const task = { id: 7, title: 'Decision', pendingRequestId: null };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) =>
      String(input).endsWith('/unlock') ? json(session) : json({ task, changed: true }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { monitorClient } = await import('../../src/pages/monitor/client');
    await monitorClient.unlock('1234');
    await monitorClient.answerRequest(PROJECT_ID, 7, { requestId: 'r', choiceId: 'yes' });
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      '/monitor/api/unlock',
      `/monitor/api/projects/${PROJECT_ID}/tasks/7/answer`,
    ]);
    const headers = fetchMock.mock.calls[1]?.[1]?.headers as Record<string, string>;
    expect(headers['X-Agboard-Csrf']).toBe('csrf-9');
  });

  it('an answer without a session tells the app the passcode is needed and sends nothing', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      json({ error: { code: 'session_required' } }, 401),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { monitorClient, onMonitorAuthLoss } = await import('../../src/pages/monitor/client');
    const seen: string[] = [];
    const off = onMonitorAuthLoss((loss) => seen.push(loss));
    await expect(
      monitorClient.answerRequest(PROJECT_ID, 7, { requestId: 'r', choiceId: 'yes' }),
    ).rejects.toMatchObject({ status: 401, code: 'session_required' });
    off();
    expect(seen).toEqual(['session_required']);
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual(['/monitor/api/session']);
  });
});
