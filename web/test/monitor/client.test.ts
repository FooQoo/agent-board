import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { changed, summaryOf, taskStream } from '../../src/shared/data/core/test-support';

const PROJECT_ID = 'a'.repeat(32);

afterEach(() => vi.unstubAllGlobals());

const SUMMARY = summaryOf([{ id: 4, document: 'dv1', history: 'hv1' }], 'sv1', PROJECT_ID, [
  { id: 'ABC-1', document: 'ev1' },
]);
const ok = (body: unknown, type = 'application/json') =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': type },
  });
const NDJSON = (events: unknown[]) =>
  `${events.map((event) => JSON.stringify(event)).join('\n')}\n`;
const signal = () => new AbortController().signal;

async function drain<T>(events: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const event of events) out.push(event);
  return out;
}

describe('monitor adapter requests', () => {
  it('reads the Summary of its own project from the fixed GET route', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ok(SUMMARY));
    vi.stubGlobal('fetch', fetchMock);
    const { createMonitorAdapter } = await import('../../src/pages/monitor/client');
    const adapter = createMonitorAdapter(PROJECT_ID);
    await expect(adapter.fetchSummary(PROJECT_ID, signal())).resolves.toEqual(SUMMARY);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [input, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(input)).toBe(`/monitor/api/projects/${PROJECT_ID}/summary`);
    expect(init?.method).toBeUndefined();
    expect(init?.headers).toEqual({ Accept: 'application/json' });
    expect(init?.cache).toBe('no-store');
  });

  it('never asks for another project, and rejects unsafe IDs before any request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { createMonitorAdapter } = await import('../../src/pages/monitor/client');
    expect(() => createMonitorAdapter('../api')).toThrow(/project/i);
    const adapter = createMonitorAdapter(PROJECT_ID);
    await expect(adapter.fetchSummary('b'.repeat(32), signal())).rejects.toThrow(/own project/);
    expect(() =>
      adapter.streamDetail(
        { resource: { kind: 'task', projectId: 'b'.repeat(32), id: 1 }, sections: ['document'] },
        signal(),
      ),
    ).toThrow(/own project/);
    expect(() =>
      adapter.streamDetail(
        { resource: { kind: 'task', projectId: PROJECT_ID, id: 0 }, sections: ['document'] },
        signal(),
      ),
    ).toThrow(/task/i);
    expect(() =>
      adapter.streamDetail(
        { resource: { kind: 'epic', projectId: PROJECT_ID, id: '../' }, sections: ['document'] },
        signal(),
      ),
    ).toThrow(/epic/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('streams a task Detail from its route with the sections asked for', async () => {
    const events = taskStream(4, { document: 'dv1', history: 'hv1' }, { projectId: PROJECT_ID });
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      ok(NDJSON(events), 'application/x-ndjson'),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { createMonitorAdapter } = await import('../../src/pages/monitor/client');
    const adapter = createMonitorAdapter(PROJECT_ID);
    const got = await drain(
      adapter.streamDetail(
        {
          resource: { kind: 'task', projectId: PROJECT_ID, id: 4 },
          sections: ['document', 'history'],
        },
        signal(),
      ),
    );
    expect(got).toEqual(events);
    const [input, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(input)).toBe(
      `/monitor/api/projects/${PROJECT_ID}/tasks/4/detail?sections=document,history`,
    );
    expect(init?.headers).toEqual({ Accept: 'application/x-ndjson' });
    expect(init?.method).toBeUndefined();
  });

  it('streams an epic document from the epic route', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      ok(
        NDJSON([
          {
            type: 'start',
            resource: 'epic',
            id: 'ABC-1',
            projectId: PROJECT_ID,
            sections: ['document'],
            versions: { document: 'ev1' },
          },
          { type: 'complete', versions: { document: 'ev1' } },
        ]),
        'application/x-ndjson',
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { createMonitorAdapter } = await import('../../src/pages/monitor/client');
    const adapter = createMonitorAdapter(PROJECT_ID);
    await drain(
      adapter.streamDetail(
        { resource: { kind: 'epic', projectId: PROJECT_ID, id: 'ABC-1' }, sections: ['document'] },
        signal(),
      ),
    );
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      `/monitor/api/projects/${PROJECT_ID}/epics/ABC-1/detail?sections=document`,
    );
  });

  it('builds attachment URLs from fixed segments and rejects unsafe ones', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const { monitorReadResolvers } = await import('../../src/pages/monitor/client');
    expect(monitorReadResolvers.attachmentUrl(PROJECT_ID, 4, 'b'.repeat(32))).toBe(
      `/monitor/api/projects/${PROJECT_ID}/tasks/4/attachments/${'b'.repeat(32)}`,
    );
    expect(monitorReadResolvers.epicAttachmentUrl(PROJECT_ID, 'ABC-1', 'b'.repeat(32))).toBe(
      `/monitor/api/projects/${PROJECT_ID}/epics/ABC-1/attachments/${'b'.repeat(32)}`,
    );
    expect(() => monitorReadResolvers.attachmentUrl(PROJECT_ID, 0, 'x')).toThrow(/task/i);
    expect(() => monitorReadResolvers.epicAttachmentUrl(PROJECT_ID, '../', 'b'.repeat(32))).toThrow(
      /epic/i,
    );
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
            { status: 404, headers: { 'Content-Type': 'application/json' } },
          ),
      ),
    );
    const { createMonitorAdapter, MonitorClientError } = await import(
      '../../src/pages/monitor/client'
    );
    await expect(
      createMonitorAdapter(PROJECT_ID).fetchSummary(PROJECT_ID, signal()),
    ).rejects.toMatchObject({
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
    const { createMonitorAdapter } = await import('../../src/pages/monitor/client');
    // The Summary read uses the default window; the timer is faked, so run it out.
    const request = createMonitorAdapter(PROJECT_ID).fetchSummary(PROJECT_ID, signal());
    const rejection = expect(request).rejects.toMatchObject({ code: 'timeout', status: 0 });
    await vi.advanceTimersByTimeAsync(10_001);
    await rejection;
    vi.useRealTimers();
  });

  it('stops reading when the caller aborts', async () => {
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { createMonitorAdapter } = await import('../../src/pages/monitor/client');
    const controller = new AbortController();
    const request = createMonitorAdapter(PROJECT_ID).fetchSummary(PROJECT_ID, controller.signal);
    const rejection = expect(request).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await rejection;
  });
});

describe('monitorErrorStatus', () => {
  it("finds the status of the monitor error, also under the data layer's wrapper", async () => {
    const { MonitorClientError, monitorErrorStatus } = await import(
      '../../src/pages/monitor/client'
    );
    const error = new MonitorClientError('gone', 404, 'project_not_found');
    expect(monitorErrorStatus(error)).toBe(404);
    expect(monitorErrorStatus(new Error('transport: x', { cause: error }))).toBe(404);
    expect(monitorErrorStatus(new Error('plain'))).toBeNull();
    expect(monitorErrorStatus(null)).toBeNull();
  });
});

describe('monitor adapter events', () => {
  class FakeEventSource {
    static instances: FakeEventSource[] = [];
    listeners = new Map<string, Array<(event: Event) => void>>();
    closed = false;
    constructor(readonly url: string) {
      FakeEventSource.instances.push(this);
    }
    addEventListener(type: string, listener: (event: Event) => void) {
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
    }
    close() {
      this.closed = true;
    }
    emit(type: string, data?: string) {
      const event = new MessageEvent(type, { data });
      for (const listener of this.listeners.get(type) ?? []) listener(event);
    }
  }

  function handlers() {
    return {
      onChanged: vi.fn(),
      onReset: vi.fn(),
      onOpen: vi.fn(),
      onClose: vi.fn(),
      onHeartbeat: vi.fn(),
      onReady: vi.fn(),
      onPreferences: vi.fn(),
    };
  }

  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
  });

  it('follows only its project: the stream address carries ?project=', async () => {
    const { createMonitorAdapter } = await import('../../src/pages/monitor/client');
    createMonitorAdapter(PROJECT_ID).openEvents(handlers());
    expect(FakeEventSource.instances.map((source) => source.url)).toEqual([
      `/monitor/api/events?project=${PROJECT_ID}`,
    ]);
  });

  it('tells the core when the subscription is open, with the build, and passes the signs of life', async () => {
    const { createMonitorAdapter } = await import('../../src/pages/monitor/client');
    const h = handlers();
    const close = createMonitorAdapter(PROJECT_ID).openEvents(h);
    const source = FakeEventSource.instances[0] as FakeEventSource;
    source.emit('ready', JSON.stringify({ build: '0123456789abcdef' }));
    expect(h.onReady).toHaveBeenCalledWith('0123456789abcdef');
    expect(h.onOpen).toHaveBeenCalledTimes(1);
    source.emit('heartbeat', '{}');
    expect(h.onHeartbeat).toHaveBeenCalledTimes(1);
    source.emit('preferences', '{}');
    expect(h.onPreferences).toHaveBeenCalledTimes(1);
    source.emit('error');
    expect(h.onClose).toHaveBeenCalledTimes(1);
    close();
    expect(source.closed).toBe(true);
  });

  it('passes a changed event on as the contract, and asks for a reset for one it cannot trust', async () => {
    const { createMonitorAdapter } = await import('../../src/pages/monitor/client');
    const h = handlers();
    createMonitorAdapter(PROJECT_ID).openEvents(h);
    const source = FakeEventSource.instances[0] as FakeEventSource;
    const event = changed(1, [{ resource: 'task', id: 4, facets: ['summary'] }], PROJECT_ID);
    source.emit('changed', JSON.stringify(event));
    expect(h.onChanged).toHaveBeenCalledWith(event);
    source.emit('changed', '{"nonsense":true}');
    expect(h.onReset).toHaveBeenLastCalledWith('unknown-event');
    source.emit('resync', JSON.stringify({ instanceId: 'i1', seq: 3 }));
    expect(h.onReset).toHaveBeenLastCalledWith('seq-gap');
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
    const { createMonitorAdapter, onMonitorAuthLoss } = await import(
      '../../src/pages/monitor/client'
    );
    const seen: string[] = [];
    const off = onMonitorAuthLoss((loss) => seen.push(loss));
    const adapter = createMonitorAdapter(PROJECT_ID);
    await expect(adapter.fetchSummary(PROJECT_ID, signal())).rejects.toMatchObject({
      code: 'session_required',
    });
    await expect(adapter.fetchSummary(PROJECT_ID, signal())).rejects.toMatchObject({
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
    const { createMonitorAdapter, onMonitorAuthLoss } = await import(
      '../../src/pages/monitor/client'
    );
    const listener = vi.fn();
    const off = onMonitorAuthLoss(listener);
    await expect(
      createMonitorAdapter(PROJECT_ID).fetchSummary(PROJECT_ID, signal()),
    ).rejects.toMatchObject({ status: 401 });
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
