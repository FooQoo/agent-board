import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ResidentRequestError,
  getModels,
  getSessions,
  launchSession,
  saveAutoStart,
  stopSession,
} from './api';
import { PROJECT, snapshotOf } from './fixtures';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Answers every call with a fresh copy, because a body can be read once. */
function stubFetch(response: Response) {
  const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(response.clone()));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe('the reads', () => {
  it('get the sessions of the project', async () => {
    const body = snapshotOf({ state: 'running', tool: 'codex' });
    const fetchMock = stubFetch(json(body));
    await expect(getSessions(PROJECT)).resolves.toEqual(body);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`/api/projects/${PROJECT}/sessions`);
  });

  it('ask for the models of one tool', async () => {
    const fetchMock = stubFetch(json({ models: [{ id: 'opus', label: 'Opus' }], reason: null }));
    const list = await getModels(PROJECT, 'claude-code');
    expect(list.models).toEqual([{ id: 'opus', label: 'Opus' }]);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `/api/projects/${PROJECT}/sessions/models?tool=claude-code`,
    );
  });

  it('fail with the status and error code of the server', async () => {
    stubFetch(json({ error: { code: 'agent_cli_missing', message: 'm', reason: 'r' } }, 409));
    await expect(getModels(PROJECT, 'codex')).rejects.toMatchObject({
      status: 409,
      code: 'agent_cli_missing',
    });
  });
});

describe('the writes', () => {
  it('launch without a model key when the default is chosen', async () => {
    const fetchMock = stubFetch(json({ launched: {} }));
    await launchSession(PROJECT, 'codex', '');
    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe(`/api/projects/${PROJECT}/sessions/launch`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ tool: 'codex' });
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('launch with the chosen model', async () => {
    const fetchMock = stubFetch(json({ launched: {} }));
    await launchSession(PROJECT, 'claude-code', 'opus');
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({ tool: 'claude-code', model: 'opus' });
  });

  it('stop with an empty body', async () => {
    const fetchMock = stubFetch(json({ stopped: true }));
    await expect(stopSession(PROJECT)).resolves.toEqual({ stopped: true });
    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe(`/api/projects/${PROJECT}/sessions/stop`);
    expect(JSON.parse(init.body as string)).toEqual({});
  });

  it('save auto-start with the tool and model, or only the switch when it is off', async () => {
    const fetchMock = stubFetch(json({ autoStart: null }));
    await saveAutoStart(PROJECT, { enabled: true, tool: 'codex', model: 'gpt-5.4' });
    await saveAutoStart(PROJECT, { enabled: false });
    const bodies = fetchMock.mock.calls.map((call) =>
      JSON.parse((call[1] as RequestInit).body as string),
    );
    expect(bodies).toEqual([
      { enabled: true, tool: 'codex', model: 'gpt-5.4' },
      { enabled: false },
    ]);
    const [, firstInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(firstInit.method).toBe('PUT');
  });

  it('carry the code and the server reason of a refusal', async () => {
    stubFetch(
      json(
        { error: { code: 'session_launch_refused', message: 'm', reason: 'Stop Codex first.' } },
        409,
      ),
    );
    const error = await launchSession(PROJECT, 'codex', '').catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ResidentRequestError);
    expect(error).toMatchObject({
      status: 409,
      code: 'session_launch_refused',
      reason: 'Stop Codex first.',
    });
  });

  it('report a request that never got an answer as status 0', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    await expect(stopSession(PROJECT)).rejects.toMatchObject({ status: 0, code: null });
  });
});
