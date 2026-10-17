import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useTaskLifecycle } from '../../src/hooks/useTaskLifecycle';
import { useProjectSession } from '../../src/hooks/useProjectSession';
import { deferred, jsonResponse, stubBackend } from '../fakes';
import { PROJECT_A, PROJECT_B, PROJECTS, boardOf, fixtureBoard } from '../fixtures';

afterEach(() => vi.unstubAllGlobals());

function createBackend(write?: (url: string, init: RequestInit) => Response | Promise<Response>) {
  return {
    projects: PROJECTS,
    boards: {
      [PROJECT_A.id]: fixtureBoard,
      [PROJECT_B.id]: boardOf(PROJECT_B, []),
    },
    write,
  };
}

describe('useCardLifecycle', () => {
  it('sends once to the operation project, holds a URL switch, and applies it when done', async () => {
    const response = deferred<Response>();
    const fetchMock = stubBackend(createBackend(() => response.promise));
    const { result } = renderHook(() => {
      const session = useProjectSession(PROJECT_A.id);
      const lifecycle = useTaskLifecycle(session.operations);
      return { session, lifecycle };
    });

    let first!: Promise<{ ok: boolean }>;
    await act(async () => {
      first = result.current.lifecycle.run('restore', PROJECT_A.id, { taskId: 7 });
      const second = await result.current.lifecycle.run('restore', PROJECT_A.id, { taskId: 7 });
      expect(second.ok).toBe(false);
      result.current.session.dispatch({ type: 'URL_REQUESTED', projectId: PROJECT_B.id });
    });
    expect(result.current.session.session.activeProjectId).toBe(PROJECT_A.id);
    expect(result.current.session.session.pendingTarget?.projectId).toBe(PROJECT_B.id);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
    expect(String(fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')?.[0])).toContain(
      `/api/projects/${PROJECT_A.id}/tasks/7/restore`,
    );

    await act(async () => {
      response.resolve(jsonResponse({ task: {} }));
      expect(await first).toEqual({ ok: true });
    });
    await waitFor(() => expect(result.current.session.session.activeProjectId).toBe(PROJECT_B.id));
    expect(result.current.session.session.operation).toBeNull();
  });

  it('ends a failed one-shot operation so the caller can retain its selection and retry', async () => {
    stubBackend(createBackend(() => jsonResponse({ error: { reason: 'restore failed' } }, 500)));
    const { result } = renderHook(() => {
      const session = useProjectSession(PROJECT_A.id);
      return { session, lifecycle: useTaskLifecycle(session.operations) };
    });

    let outcome!: { ok: boolean };
    await act(async () => {
      outcome = await result.current.lifecycle.run('restore', PROJECT_A.id, { taskId: 7 });
    });
    expect(outcome.ok).toBe(false);
    expect(result.current.session.session.operation).toBeNull();
  });
});
