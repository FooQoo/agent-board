/**
 * The phone client against the real ngrok monitor backend on loopback.
 *
 * The backend comes from `tests/monitor_phone_serve.rs` (a fake connector opens the "tunnel").
 * The test stands in for the browser and the Edge: it adds the public Host, keeps the cookie, and
 * adds Origin and Sec-Fetch-Site to writes. How a real Edge forwards a request is NOT exercised;
 * a page that is not the monitor is simulated. The passcode is
 * the one the backend announces for each start, as the PC would show it.
 *
 * It starts cargo, so it runs only with AGBOARD_PHONE_LIVE=1.
 */
import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import http from 'node:http';
import { resolve } from 'node:path';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  MonitorClientError,
  createMonitorAdapter,
  monitorClient,
  onMonitorAuthLoss,
  type MonitorAuthLoss,
} from '../../src/pages/monitor/client';
import { useMonitorConnection } from '../../src/pages/monitor/hooks/useMonitorConnection';
import { DataCore, type ConnectionState } from '../../src/shared/data/core';

const live = process.env.AGBOARD_PHONE_LIVE === '1';

interface Backend {
  addr: string;
  passcode: string;
  host: string;
  origin: string;
}

let child: ChildProcessWithoutNullStreams;
let backend: Backend;
let projectId = '';
const lines: string[] = [];
const pending: Array<() => void> = [];
const browser = { cookie: new Map<string, string>(), notTheMonitor: false, wrote: 0 };

function waitForLine(prefix: string, since: number): Promise<string> {
  return new Promise((resolveLine, reject) => {
    const timer = setTimeout(() => reject(new Error(`no ${prefix} line`)), 90_000);
    const check = () => {
      const found = lines.slice(since).find((line) => line.startsWith(prefix));
      if (found === undefined) return false;
      clearTimeout(timer);
      resolveLine(found.slice(prefix.length).trim());
      return true;
    };
    if (!check()) pending.push(() => check());
  });
}

async function command(name: string, expect: 'READY' | 'STOPPED') {
  const since = lines.length;
  child.stdin.write(`${name}\n`);
  const line = await waitForLine(expect, since);
  if (expect === 'READY') backend = JSON.parse(line) as Backend;
}

function cookieHeader(): string {
  return [...browser.cookie].map(([k, v]) => `${k}=${v}`).join('; ');
}

function absorb(setCookie: string[] | undefined) {
  for (const raw of setCookie ?? []) {
    const [pair = '', ...attrs] = raw.split(';').map((part) => part.trim());
    const [name = '', value = ''] = pair.split('=');
    if (attrs.some((a) => a.toLowerCase() === 'max-age=0') || value === '')
      browser.cookie.delete(name);
    else browser.cookie.set(name, value);
  }
}

function send(path: string, init: RequestInit = {}, stream = false): Promise<http.IncomingMessage> {
  const [hostname = '', port = ''] = backend.addr.split(':');
  const method = init.method ?? 'GET';
  const headers: Record<string, string> = {
    Host: backend.host,
    'Sec-Fetch-Site': 'same-origin',
    ...(browser.cookie.size > 0 ? { Cookie: cookieHeader() } : {}),
    ...(method === 'GET' ? {} : { Origin: backend.origin }),
    ...(init.headers as Record<string, string>),
  };
  if (stream) headers.Accept = 'text/event-stream';
  return new Promise((resolveReq, reject) => {
    const req = http.request({ hostname, port: Number(port), path, method, headers }, (res) => {
      absorb(res.headers['set-cookie']);
      resolveReq(res);
    });
    req.on('error', reject);
    if (init.body !== undefined) req.write(init.body as string);
    req.end();
  });
}

/** What the browser's fetch would return for the page behind the Edge. */
async function browserFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  if (browser.notTheMonitor) {
    const redirect = new Response(null, { status: 200 });
    Object.defineProperty(redirect, 'type', { value: 'opaqueredirect' });
    return redirect;
  }
  const path = String(input);
  if ((init.method ?? 'GET') !== 'GET') browser.wrote += 1;
  let res: http.IncomingMessage;
  try {
    res = await send(path, init);
  } catch {
    throw new TypeError('Failed to fetch');
  }
  const chunks: Buffer[] = [];
  for await (const chunk of res) chunks.push(chunk as Buffer);
  return new Response(Buffer.concat(chunks), {
    status: res.statusCode ?? 0,
    headers: { 'content-type': String(res.headers['content-type'] ?? '') },
  });
}

/** A small EventSource over the same bridge: `ready`, `changed` and `heartbeat` events. */
class BridgeEventSource {
  static all: BridgeEventSource[] = [];
  readonly listeners = new Map<string, Array<(event: Event) => void>>();
  closed = false;
  constructor(readonly url: string) {
    BridgeEventSource.all.push(this);
    void this.run();
  }
  addEventListener(type: string, listener: (event: Event) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  close() {
    this.closed = true;
  }
  private emit(type: string, data = '') {
    if (this.closed) return;
    for (const listener of this.listeners.get(type) ?? [])
      listener(Object.assign(new Event(type), { data }));
  }
  private async run() {
    try {
      const res = await send(this.url, {}, true);
      if (res.statusCode !== 200 || browser.notTheMonitor) {
        this.emit('error');
        res.destroy();
        return;
      }
      let buffer = '';
      for await (const chunk of res) {
        if (this.closed) {
          res.destroy();
          return;
        }
        buffer += String(chunk);
        for (;;) {
          const end = buffer.indexOf('\n\n');
          if (end === -1) break;
          const block = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const type = /^event: (.*)$/m.exec(block)?.[1];
          const data = /^data: (.*)$/m.exec(block)?.[1] ?? '';
          if (type) this.emit(type, data);
        }
      }
      this.emit('error');
    } catch {
      this.emit('error');
    }
  }
}

/** Reads the Summary of the backend's project, as the phone does. */
function readSummary() {
  return createMonitorAdapter(projectId).fetchSummary(projectId, new AbortController().signal);
}

async function firstPendingRequest() {
  const board = await readSummary();
  const task = board.tasks.find((t) => t.pendingRequestId !== null);
  if (!task?.pendingRequestId) throw new Error('no pending request');
  return { taskId: task.id, requestId: task.pendingRequestId, choice: task.pendingChoices[0]?.id };
}

const losses: MonitorAuthLoss[] = [];
let unsubscribe = () => {};

beforeAll(async () => {
  if (!live) return;
  child = spawn(
    'cargo',
    ['test', '--test', 'monitor_phone_serve', '--', '--ignored', '--nocapture'],
    { cwd: resolve(__dirname, '../../..'), env: { ...process.env, TZ: 'UTC' } },
  );
  let partial = '';
  child.stdout.on('data', (chunk: Buffer) => {
    partial += chunk.toString();
    const parts = partial.split('\n');
    partial = parts.pop() ?? '';
    lines.push(...parts);
    for (const check of [...pending]) check();
  });
  projectId = await waitForLine('PROJECT', 0);
  backend = JSON.parse(await waitForLine('READY', 0)) as Backend;
  vi.stubGlobal('fetch', browserFetch);
  vi.stubGlobal('EventSource', BridgeEventSource);
  unsubscribe = onMonitorAuthLoss((loss) => losses.push(loss));
}, 180_000);

afterAll(() => {
  unsubscribe();
  vi.unstubAllGlobals();
  if (live && child) {
    child.stdin.write('quit\n');
    setTimeout(() => child.kill(), 3000).unref();
  }
});

afterEach(() => {
  browser.cookie.clear();
  browser.notTheMonitor = false;
  browser.wrote = 0;
  losses.length = 0;
  for (const source of BridgeEventSource.all) source.close();
  BridgeEventSource.all = [];
});

describe.skipIf(!live)('the phone client against the real backend', () => {
  it('reads nothing without a session, then the passcode opens one and reads', async () => {
    document.head.innerHTML = '';
    await expect(readSummary()).rejects.toMatchObject({
      status: 401,
      code: 'session_required',
    });
    expect(losses).toEqual(['session_required']);
    // Asking for the session starts none.
    await expect(monitorClient.openSession()).rejects.toMatchObject({ code: 'session_required' });
    expect(browser.cookie.size).toBe(0);
    const session = await monitorClient.unlock(backend.passcode);
    expect(session.csrfToken.length).toBeGreaterThan(8);
    expect(browser.cookie.size).toBe(1);
    const summary = await readSummary();
    expect(summary.project.id).toBe(projectId);
    expect(summary.tasks.length).toBeGreaterThan(0);
  });

  it('answers with the CSRF token, and never resends a refused answer', async () => {
    await monitorClient.unlock(backend.passcode);
    const pendingRequest = await firstPendingRequest();
    // The same write without the token is refused by the real guard.
    const bare = await send(
      `/monitor/api/projects/${projectId}/tasks/${pendingRequest.taskId}/answer`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: pendingRequest.requestId,
          choiceId: pendingRequest.choice,
        }),
      },
    );
    expect(bare.statusCode).toBe(403);
    bare.resume();

    const result = await monitorClient.answerRequest(projectId, pendingRequest.taskId, {
      requestId: pendingRequest.requestId,
      choiceId: pendingRequest.choice,
    });
    expect(result.task.pendingRequestId).toBeNull();
    expect(browser.wrote).toBe(2); // the unlock and the answer
  });

  it('an answer after the session ended is refused once, tells the app, and is not resent', async () => {
    await monitorClient.unlock(backend.passcode);
    const pendingRequest = await firstPendingRequest().catch(() => ({
      taskId: 1,
      requestId: 'r',
      choice: 'keep',
    }));
    await command('rotate', 'READY'); // the old session no longer counts
    browser.wrote = 0;
    await expect(
      monitorClient.answerRequest(projectId, pendingRequest.taskId, {
        requestId: pendingRequest.requestId,
        choiceId: pendingRequest.choice,
      }),
    ).rejects.toMatchObject({ status: 401, code: 'session_required' });
    expect(browser.wrote).toBe(1);
    expect(losses).toContain('session_required');
  }, 30_000);

  it('does not take a wrong passcode, and five in a row close the run to the right one', async () => {
    const wrong = backend.passcode === '0000' ? '0001' : '0000';
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(monitorClient.unlock(wrong)).rejects.toMatchObject({
        status: 403,
        code: 'unlock_failed',
      });
    }
    expect(browser.cookie.size).toBe(0);
    await expect(monitorClient.unlock(backend.passcode)).rejects.toMatchObject({
      status: 429,
      code: 'unlock_locked',
    });
    expect(browser.cookie.size).toBe(0);
    await expect(readSummary()).rejects.toMatchObject({ code: 'session_required' });
    // Starting the connection again is a new run with a new passcode and a clean count.
    await command('rotate', 'READY');
    await expect(monitorClient.unlock(backend.passcode)).resolves.toBeTruthy();
    await expect(readSummary()).resolves.toBeTruthy();
  }, 30_000);

  it('treats a page that is not the monitor as a lost connection and never asks for a passcode', async () => {
    browser.notTheMonitor = true;
    await expect(monitorClient.openSession()).rejects.toMatchObject({
      code: 'unexpected_response',
    });
    await expect(readSummary()).rejects.toBeInstanceOf(MonitorClientError);
    expect(losses).toEqual(['unexpected_response']);
    const hook = renderHook(() => useMonitorConnection());
    await waitFor(() => expect(hook.result.current.state).toEqual({ status: 'reconnecting' }));
  });

  it('asks for the passcode again when the tunnel is replaced, and the new passcode opens it', async () => {
    const hook = renderHook(() => useMonitorConnection());
    await waitFor(() =>
      expect(hook.result.current.state).toEqual({ status: 'needs_passcode', failure: null }),
    );
    await act(async () => {
      await hook.result.current.unlock(backend.passcode);
    });
    expect(hook.result.current.state.status).toBe('ready');
    await command('rotate', 'READY');
    await expect(readSummary()).rejects.toMatchObject({ code: 'session_required' });
    await waitFor(() =>
      expect(hook.result.current.state).toEqual({ status: 'needs_passcode', failure: 'expired' }),
    );
    await act(async () => {
      await hook.result.current.unlock(backend.passcode);
    });
    await waitFor(() => expect(hook.result.current.state.status).toBe('ready'));
    await expect(readSummary()).resolves.toBeTruthy();
  }, 30_000);

  it('drops the event stream when the session ends, then reconnects once a session is back', async () => {
    await monitorClient.unlock(backend.passcode);
    const states: ConnectionState[] = [];
    const core = new DataCore({
      adapter: createMonitorAdapter(projectId),
      onConnectionState: (state) => states.push(state),
    });
    core.start();
    const last = () => states[states.length - 1];
    await waitFor(() => expect(last()).toBe('connected'), { timeout: 10_000 });
    await command('rotate', 'READY');
    await waitFor(() => expect(last()).toBe('disconnected'), { timeout: 10_000 });
    await act(async () => {
      await monitorClient.unlock(backend.passcode);
    });
    await waitFor(() => expect(last()).toBe('connected'), { timeout: 20_000 });
    core.dispose();
  }, 60_000);

  it('shows an unreachable monitor as reconnecting, then as a failure on the passcode screen', async () => {
    await command('stop', 'STOPPED');
    const hook = renderHook(() => useMonitorConnection());
    await waitFor(() => expect(hook.result.current.state.status).toBe('reconnecting'), {
      timeout: 5_000,
    });
    await waitFor(
      () =>
        expect(hook.result.current.state).toEqual({
          status: 'needs_passcode',
          failure: 'unreachable',
        }),
      { timeout: 15_000 },
    );
  }, 30_000);
});
