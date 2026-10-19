import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Board, ProjectList } from '../../src/shared/api/contracts';
import { useMonitor, type MonitorReadApi } from '../../src/pages/monitor/hooks/useMonitor';
import {
  PROJECT_A,
  PROJECT_B,
  PROJECT_C,
  PROJECTS,
  boardOf,
  fixtureBoard,
  makeTask,
} from '../fixtures';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function apiFor(
  projects = PROJECTS,
  boards: Record<string, Board> = {
    [PROJECT_A.id]: structuredClone(fixtureBoard),
    [PROJECT_B.id]: boardOf(
      PROJECT_B,
      [makeTask({ id: 2, taskStatus: 'doing', agentStatus: 'running' })],
      2,
    ),
    [PROJECT_C.id]: boardOf(PROJECT_C, [], 3),
  },
): MonitorReadApi {
  const catalog: ProjectList = { projects, catalogVersion: 'catalog-1' };
  return {
    fetchCatalog: vi.fn(async () => catalog),
    fetchBoard: vi.fn(async (id) => {
      const board = boards[id];
      if (!board) throw new Error(`No fixture board for ${id}`);
      return board;
    }),
  };
}

afterEach(() => vi.useRealTimers());

describe('useMonitor', () => {
  it('reads catalog, boards with versions, then confirms the catalog before publishing a full snapshot', async () => {
    const api = apiFor();
    const { result } = renderHook(() =>
      useMonitor({ api, now: () => new Date('2026-10-11T02:00:00Z') }),
    );
    await waitFor(() => expect(result.current.freshness.state).toBe('fresh'));
    expect(api.fetchCatalog).toHaveBeenCalledTimes(2);
    expect(api.fetchBoard).toHaveBeenCalledTimes(3);
    expect(result.current.projects).toEqual(PROJECTS);
    expect(result.current.projectVersions).toEqual({
      [PROJECT_A.id]: 'fixture-25',
      [PROJECT_B.id]: 'v2',
      [PROJECT_C.id]: 'v3',
    });
    expect(result.current.freshness.lastFetchedAt).toBe('2026-10-11T02:00:00.000Z');
  });

  it('discards a snapshot when catalog changes during the read and repeats from the new catalog', async () => {
    const first = { projects: [PROJECT_A], catalogVersion: 'before' };
    const next = { projects: [PROJECT_B], catalogVersion: 'after' };
    const catalog = vi
      .fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(next)
      .mockResolvedValueOnce(next)
      .mockResolvedValueOnce(next);
    const api: MonitorReadApi = {
      fetchCatalog: catalog,
      fetchBoard: vi.fn(async () => boardOf(PROJECT_B, [makeTask({ id: 7 })], 7)),
    };
    const { result } = renderHook(() => useMonitor({ api }));
    await waitFor(() => expect(result.current.freshness.state).toBe('fresh'));
    expect(catalog).toHaveBeenCalledTimes(4);
    expect(api.fetchBoard).toHaveBeenCalledTimes(2);
    expect(result.current.projects).toEqual([PROJECT_B]);
    expect(result.current.tasks.map(({ projectId }) => projectId)).toEqual([PROJECT_B.id]);
  });

  it('limits All Projects board reads to four at a time', async () => {
    const projects = Array.from({ length: 7 }, (_, index) => ({
      ...PROJECT_A,
      id: `${index.toString(16).padStart(1, '0')}${'a'.repeat(31)}`,
      name: `p${index}`,
    }));
    let active = 0;
    let maximum = 0;
    const gate = deferred<void>();
    const api: MonitorReadApi = {
      fetchCatalog: vi.fn(async () => ({ projects, catalogVersion: 'many' })),
      fetchBoard: vi.fn(async (id) => {
        active++;
        maximum = Math.max(maximum, active);
        await gate.promise;
        active--;
        const project = projects.find((entry) => entry.id === id);
        if (!project) throw new Error(`No fixture project for ${id}`);
        return boardOf(project, [], 1);
      }),
    };
    const { result } = renderHook(() => useMonitor({ api }));
    await waitFor(() => expect(api.fetchBoard).toHaveBeenCalledTimes(4));
    expect(maximum).toBe(4);
    await act(async () => gate.resolve());
    await waitFor(() => expect(result.current.freshness.state).toBe('fresh'));
    expect(api.fetchBoard).toHaveBeenCalledTimes(7);
    expect(maximum).toBe(4);
  });

  it('keeps only successful projects during partial failure and retries failed projects with backoff', async () => {
    vi.useFakeTimers();
    const api = apiFor();
    vi.mocked(api.fetchBoard).mockImplementation(async (id) => {
      if (id === PROJECT_B.id) throw new Error('offline');
      return id === PROJECT_A.id ? structuredClone(fixtureBoard) : boardOf(PROJECT_C, [], 3);
    });
    const { result } = renderHook(() => useMonitor({ api }));
    await act(async () => {
      for (let i = 0; i < 12; i++) await Promise.resolve();
    });
    expect(result.current.freshness.state).toBe('partial');
    expect(result.current.freshness.failedProjectIds).toEqual([PROJECT_B.id]);
    expect(result.current.tasks.every(({ projectId }) => projectId !== PROJECT_B.id)).toBe(true);
    const requests = vi.mocked(api.fetchCatalog).mock.calls.length;
    await act(async () => vi.advanceTimersByTimeAsync(999));
    expect(api.fetchCatalog).toHaveBeenCalledTimes(requests);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    await act(async () => {
      for (let i = 0; i < 12; i++) await Promise.resolve();
    });
    expect(api.fetchCatalog).toHaveBeenCalledTimes(requests + 2);
  });

  it('treats HTTP-success problems as partial and holds the last complete timestamp without retrying', async () => {
    vi.useFakeTimers();
    const api = apiFor([PROJECT_A]);
    vi.mocked(api.fetchBoard).mockImplementation(async () => ({
      ...structuredClone(fixtureBoard),
      problems: [{ file: 'projects/x/tasks/1/TASK.md', field: 'format', reason: 'bad body' }],
    }));
    const { result } = renderHook(() =>
      useMonitor({ api, now: () => new Date('2026-10-11T02:00:00Z') }),
    );
    await act(async () => {
      for (let i = 0; i < 12; i++) await Promise.resolve();
    });
    expect(result.current.freshness.state).toBe('partial');
    expect(result.current.freshness.snapshotProblems).toEqual([
      {
        projectId: PROJECT_A.id,
        file: 'projects/x/tasks/1/TASK.md',
        field: 'format',
        reason: 'bad body',
      },
    ]);
    expect(result.current.freshness.lastFetchedAt).toBeNull();
    const requests = vi.mocked(api.fetchCatalog).mock.calls.length;
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(api.fetchCatalog).toHaveBeenCalledTimes(requests);
  });

  it('repairs HTTP-success problems on the next explicit change refresh', async () => {
    const api = apiFor([PROJECT_A]);
    vi.mocked(api.fetchBoard)
      .mockResolvedValueOnce({
        ...structuredClone(fixtureBoard),
        problems: [{ file: 'tasks/1/TASK.md', field: 'description', reason: 'invalid section' }],
      })
      .mockResolvedValueOnce(structuredClone(fixtureBoard));
    const { result } = renderHook(() => useMonitor({ api }));
    await waitFor(() => expect(result.current.freshness.state).toBe('partial'));
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.freshness.state).toBe('fresh'));
    expect(result.current.freshness.snapshotProblems).toEqual([]);
    expect(api.fetchBoard).toHaveBeenCalledTimes(2);
  });

  it('keeps the prior full timestamp through a later partial snapshot', async () => {
    const api = apiFor([PROJECT_A]);
    const board = structuredClone(fixtureBoard);
    const fetchBoard = vi.mocked(api.fetchBoard);
    fetchBoard.mockResolvedValueOnce(board).mockResolvedValueOnce({
      ...board,
      problems: [{ file: 'tasks/1/TASK.md', field: 'heading', reason: 'bad body' }],
    });
    const { result } = renderHook(() =>
      useMonitor({ api, now: () => new Date('2026-10-11T02:00:00Z') }),
    );
    await waitFor(() => expect(result.current.freshness.state).toBe('fresh'));
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.freshness.state).toBe('partial'));
    expect(result.current.freshness.lastFetchedAt).toBe('2026-10-11T02:00:00.000Z');
  });

  it('aborts and ignores an in-flight snapshot when hidden, then reads again on resume', async () => {
    const api = apiFor([PROJECT_A]);
    const first = deferred<Board>();
    vi.mocked(api.fetchBoard)
      .mockImplementationOnce((_id, options) => {
        options?.signal?.addEventListener('abort', () =>
          first.reject(new DOMException('Aborted', 'AbortError')),
        );
        return first.promise;
      })
      .mockResolvedValueOnce(structuredClone(fixtureBoard));
    const { result } = renderHook(() => useMonitor({ api }));
    await waitFor(() => expect(api.fetchBoard).toHaveBeenCalledTimes(1));
    act(() => result.current.onVisibility(false));
    act(() => result.current.onVisibility(true));
    await waitFor(() => expect(result.current.freshness.state).toBe('fresh'));
    expect(api.fetchBoard).toHaveBeenCalledTimes(2);
    expect(result.current.tasks[0]?.projectId).toBe(PROJECT_A.id);
  });

  it('coalesces changed events during an active read into one follow-up refresh', async () => {
    const api = apiFor([PROJECT_A]);
    const first = deferred<Board>();
    vi.mocked(api.fetchBoard)
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce(structuredClone(fixtureBoard));
    const { result } = renderHook(() => useMonitor({ api }));
    await waitFor(() => expect(api.fetchBoard).toHaveBeenCalledTimes(1));
    act(() => {
      result.current.refresh();
      result.current.refresh();
      result.current.refresh();
    });
    expect(api.fetchBoard).toHaveBeenCalledTimes(1);
    await act(async () => first.resolve(structuredClone(fixtureBoard)));
    await waitFor(() => expect(api.fetchBoard).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.freshness.state).toBe('fresh'));
  });
});
