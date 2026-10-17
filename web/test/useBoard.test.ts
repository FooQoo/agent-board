import { act, renderHook, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useBoard } from '../src/hooks/useBoard';
import { deferred, stubBackend, type FakeBackend } from './fakes';
import { PROJECT_A, PROJECT_B, boardOf, fixtureBoard, makeTask } from './fixtures';

const boardA = fixtureBoard;
const boardB = boardOf(PROJECT_B, [makeTask({ id: 8, title: 'B task eight' })], 2);

function backend(overrides: Partial<FakeBackend> = {}): FakeBackend {
  return {
    projects: [PROJECT_A, PROJECT_B],
    boards: { [PROJECT_A.id]: boardA, [PROJECT_B.id]: boardB },
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useBoard', () => {
  it('starts loading and becomes ready once the board of the project is fetched', async () => {
    const fetchMock = stubBackend(backend());
    const { result } = renderHook(() => useBoard(PROJECT_A.id));

    expect(result.current.status).toBe('loading');
    expect(result.current.board).toBeNull();
    await waitFor(() => expect(result.current.status).toBe('ready'));

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/projects/${PROJECT_A.id}/board`,
      expect.anything(),
    );
    expect(result.current.board?.tasks).toHaveLength(8);
    expect(result.current.fetchFailed).toBe(false);
    expect(result.current.lastSyncedAt).toBeInstanceOf(Date);
  });

  it('does not fetch while no project is shown', () => {
    const fetchMock = stubBackend(backend());
    const { result } = renderHook(() => useBoard(null));
    expect(result.current.status).toBe('loading');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('drops the old board at once when the project changes and loads the new one', async () => {
    stubBackend(backend());
    const { result, rerender } = renderHook(({ id }) => useBoard(id), {
      initialProps: { id: PROJECT_A.id },
    });
    await waitFor(() => expect(result.current.board?.project.id).toBe(PROJECT_A.id));

    rerender({ id: PROJECT_B.id });
    expect(result.current.board).toBeNull();
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.board?.project.id).toBe(PROJECT_B.id));
    expect(result.current.board?.tasks).toHaveLength(1);
  });

  it('does not let a late answer for the old project replace the new one', async () => {
    const lateA = deferred();
    stubBackend(
      backend({ gate: (url) => (url.includes(PROJECT_A.id) ? lateA.promise : undefined) }),
    );
    const { result, rerender } = renderHook(({ id }) => useBoard(id), {
      initialProps: { id: PROJECT_A.id },
    });
    rerender({ id: PROJECT_B.id });
    await waitFor(() => expect(result.current.board?.project.id).toBe(PROJECT_B.id));

    await act(async () => {
      lateA.resolve();
      await Promise.resolve();
    });

    expect(result.current.board?.project.id).toBe(PROJECT_B.id);
    expect(result.current.board?.tasks).toHaveLength(1);
  });

  it('ignores the first answer for A when the project goes A to B to A and the answers arrive reversed', async () => {
    const first = deferred();
    const second = deferred();
    let callsForA = 0;
    const fake = backend({
      gate: (url) => {
        if (!url.includes(PROJECT_A.id)) return undefined;
        callsForA += 1;
        return callsForA === 1 ? first.promise : second.promise;
      },
    });
    stubBackend(fake);
    const { result, rerender } = renderHook(({ id }) => useBoard(id), {
      initialProps: { id: PROJECT_A.id },
    });
    rerender({ id: PROJECT_B.id });
    await waitFor(() => expect(result.current.board?.project.id).toBe(PROJECT_B.id));
    rerender({ id: PROJECT_A.id });
    expect(result.current.board).toBeNull();

    fake.boards[PROJECT_A.id] = boardOf(PROJECT_A, [makeTask({ id: 1, title: 'Newest' })], 9);
    await act(async () => {
      second.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.board?.tasks[0]?.title).toBe('Newest'));

    fake.boards[PROJECT_A.id] = boardA;
    await act(async () => {
      first.resolve();
      await Promise.resolve();
    });
    expect(result.current.board?.tasks[0]?.title).toBe('Newest');
  });

  it('is not overwritten by a request from the first StrictMode mount', async () => {
    const early = deferred();
    let calls = 0;
    const fake = backend({
      gate: () => {
        calls += 1;
        return calls === 1 ? early.promise : undefined;
      },
    });
    fake.boards[PROJECT_A.id] = boardOf(PROJECT_A, [makeTask({ id: 1, title: 'Stale' })], 1);
    stubBackend(fake);
    const { result } = renderHook(() => useBoard(PROJECT_A.id), { wrapper: StrictMode });
    fake.boards[PROJECT_A.id] = boardOf(PROJECT_A, [makeTask({ id: 1, title: 'Fresh' })], 2);
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => {
      early.resolve();
      await Promise.resolve();
    });
    expect(result.current.board?.tasks[0]?.title).not.toBe('Stale');
  });

  it('reports a missing project as not_found, not as a failure to retry', async () => {
    stubBackend(backend({ boards: { [PROJECT_A.id]: 'not_found' } }));
    const { result } = renderHook(() => useBoard(PROJECT_A.id));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toBe('not_found');
    expect(result.current.board).toBeNull();
  });

  it('reports an error when the first fetch fails and recovers on reload', async () => {
    const fake = backend({ boards: { [PROJECT_A.id]: new Error('network down') } });
    const fetchMock = stubBackend(fake);
    const { result } = renderHook(() => useBoard(PROJECT_A.id));

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toBe('failed');
    expect(result.current.fetchFailed).toBe(true);

    fake.boards[PROJECT_A.id] = boardA;
    act(() => result.current.reload());
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('treats a 500 as a failure', async () => {
    stubBackend(backend({ boards: { [PROJECT_A.id]: 500 } }));
    const { result } = renderHook(() => useBoard(PROJECT_A.id));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toBe('failed');
  });

  it('keeps the board but flags the failure when a refresh fails', async () => {
    const fake = backend();
    stubBackend(fake);
    const { result } = renderHook(() => useBoard(PROJECT_A.id));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const syncedAt = result.current.lastSyncedAt;

    fake.boards[PROJECT_A.id] = new Error('network down');
    act(() => result.current.reload());

    await waitFor(() => expect(result.current.fetchFailed).toBe(true));
    expect(result.current.status).toBe('ready');
    expect(result.current.board?.tasks).toHaveLength(8);
    expect(result.current.lastSyncedAt).toBe(syncedAt);
  });

  it('turns into not_found when a refresh finds the project deleted', async () => {
    const fake = backend();
    stubBackend(fake);
    const { result } = renderHook(() => useBoard(PROJECT_A.id));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    fake.boards[PROJECT_A.id] = 'not_found';
    act(() => result.current.reload());

    await waitFor(() => expect(result.current.error).toBe('not_found'));
    expect(result.current.board).toBeNull();
  });

  it('refreshes the shown board without going back to loading', async () => {
    const fake = backend();
    stubBackend(fake);
    const { result } = renderHook(() => useBoard(PROJECT_A.id));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    fake.boards[PROJECT_A.id] = { ...boardA, tasks: boardA.tasks.slice(0, 3) };
    act(() => result.current.reload());

    expect(result.current.status).toBe('ready');
    await waitFor(() => expect(result.current.board?.tasks).toHaveLength(3));
  });
});
