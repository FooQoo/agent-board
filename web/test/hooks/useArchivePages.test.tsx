import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useArchivePages } from '../../src/features/tasks/model/useArchivePages';
import type { Task } from '../../src/shared/api/contracts';
import { deferred, stubBackend, type FakeBackend } from '../fakes';
import { PROJECT_A, PROJECT_B, PROJECTS, boardOf, fixtureBoard, makeTask } from '../fixtures';

afterEach(() => vi.unstubAllGlobals());

function fakeBackend(gate?: (url: string) => Promise<void> | undefined): FakeBackend {
  return {
    projects: PROJECTS,
    boards: {
      [PROJECT_A.id]: fixtureBoard,
      [PROJECT_B.id]: boardOf(PROJECT_B, []),
    },
    archives: {
      [PROJECT_A.id]: [makeTask({ id: 2, title: 'Archived A' })],
      [PROJECT_B.id]: [makeTask({ id: 8, title: 'Archived B' })],
    },
    gate,
  };
}

describe('useArchivePages', () => {
  it('loads the requested project and exposes its archived tasks', async () => {
    const fetchMock = stubBackend(fakeBackend());
    const { result } = renderHook(() => useArchivePages(PROJECT_A.id));

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.data?.project.id).toBe(PROJECT_A.id);
    expect(result.current.data?.tasks.map((task) => task.title)).toEqual(['Archived A']);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/projects/${PROJECT_A.id}/archive?limit=50`,
      expect.anything(),
    );
  });

  it('labels each archived card with the epic from the same response and leaves other cards unlabeled', async () => {
    const backend = fakeBackend();
    backend.archives = {
      ...backend.archives,
      [PROJECT_A.id]: [
        { ...makeTask({ id: 2, title: 'In epic' }), epicId: 'EPIC-1' } as unknown as Task,
        makeTask({ id: 3, title: 'No epic' }),
      ],
    };
    backend.archiveEpics = {
      [PROJECT_A.id]: [
        {
          id: 'EPIC-1',
          name: 'Archived epic',
          color: '#3366CC',
          draft: null,
          document: '',
          body: '',
          waves: [],
          wavesError: false,
          attachments: [],
          createdAt: '2026-10-01T00:00:00Z',
          updatedAt: '2026-10-01T00:00:00Z',
        },
      ],
    };
    stubBackend(backend);
    const { result } = renderHook(() => useArchivePages(PROJECT_A.id));

    await waitFor(() => expect(result.current.status).toBe('ready'));
    const tasks = result.current.data?.tasks ?? [];
    const inEpic = tasks.find((task) => task.id === 2);
    const noEpic = tasks.find((task) => task.id === 3);
    expect(inEpic?.epic).toEqual({ id: 'EPIC-1', name: 'Archived epic', color: '#3366CC' });
    expect(noEpic?.epic).toBeNull();
    expect(result.current.data?.epics.map((epic) => epic.id)).toEqual(['EPIC-1']);
  });

  it('lists the archive newest first, equal times by higher id and untimed cards last', async () => {
    const backend = fakeBackend();
    const at = (id: number, archivedAt: string | null) =>
      ({ ...makeTask({ id }), archivedAt }) as unknown as Task;
    backend.archives = {
      ...backend.archives,
      [PROJECT_A.id]: [
        at(1, '2026-10-01T10:00:00Z'),
        at(2, null),
        at(3, '2026-10-03T10:00:00Z'),
        at(4, '2026-10-01T10:00:00Z'),
      ],
    };
    stubBackend(backend);
    const { result } = renderHook(() => useArchivePages(PROJECT_A.id));

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.data?.tasks.map((task) => task.id)).toEqual([3, 4, 1, 2]);
  });

  it('drops the old archive immediately and ignores a late response after switching projects', async () => {
    const lateA = deferred<void>();
    const fetchMock = stubBackend(
      fakeBackend((url) =>
        url.includes(PROJECT_A.id) && url.includes('/archive') ? lateA.promise : undefined,
      ),
    );
    const { result, rerender } = renderHook(({ id }) => useArchivePages(id), {
      initialProps: { id: PROJECT_A.id },
    });

    rerender({ id: PROJECT_B.id });
    expect(result.current.data).toBeNull();
    await waitFor(() => expect(result.current.data?.project.id).toBe(PROJECT_B.id));
    await act(async () => {
      lateA.resolve();
      await Promise.resolve();
    });
    expect(result.current.data?.tasks[0]?.title).toBe('Archived B');
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/archive'))).toHaveLength(
      2,
    );
  });

  it('keeps the previous data and marks a refresh failure', async () => {
    const backend = fakeBackend();
    stubBackend(backend);
    const { result } = renderHook(() => useArchivePages(PROJECT_A.id));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    backend.archives = { ...backend.archives, [PROJECT_A.id]: 500 };
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.fetchFailed).toBe(true));
    expect(result.current.status).toBe('ready');
    expect(result.current.data?.tasks[0]?.title).toBe('Archived A');
  });

  describe('pages', () => {
    const at = (id: number, archivedAt: string) =>
      ({ ...makeTask({ id, title: `Task ${id}` }), archivedAt }) as unknown as Task;
    // 120 archived tasks, one a minute apart; id 120 is the newest.
    const many = () =>
      Array.from({ length: 120 }, (_, i) =>
        at(i + 1, new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString()),
      );
    const withMany = (tasks: Task[] = many()) => {
      const backend = fakeBackend();
      backend.archives = { ...backend.archives, [PROJECT_A.id]: tasks };
      const fetchMock = stubBackend(backend);
      return { backend, fetchMock };
    };

    it('reads the newest page first and says how many there are', async () => {
      withMany();
      const { result } = renderHook(() => useArchivePages(PROJECT_A.id));
      await waitFor(() => expect(result.current.status).toBe('ready'));
      expect(result.current.data?.tasks).toHaveLength(50);
      expect(result.current.data?.tasks[0]?.id).toBe(120);
      expect(result.current.data?.total).toBe(120);
      expect(result.current.hasMore).toBe(true);
    });

    it('appends each page in order until the end, with no row twice', async () => {
      withMany();
      const { result } = renderHook(() => useArchivePages(PROJECT_A.id));
      await waitFor(() => expect(result.current.status).toBe('ready'));
      act(() => result.current.loadMore());
      await waitFor(() => expect(result.current.data?.tasks).toHaveLength(100));
      act(() => result.current.loadMore());
      await waitFor(() => expect(result.current.data?.tasks).toHaveLength(120));
      expect(result.current.hasMore).toBe(false);
      const ids = result.current.data?.tasks.map((task) => task.id) ?? [];
      expect(ids).toEqual(Array.from({ length: 120 }, (_, i) => 120 - i));
    });

    it('asks for one page at a time and not after the last', async () => {
      const { fetchMock } = withMany();
      const { result } = renderHook(() => useArchivePages(PROJECT_A.id));
      await waitFor(() => expect(result.current.status).toBe('ready'));
      act(() => {
        result.current.loadMore();
        result.current.loadMore();
      });
      await waitFor(() => expect(result.current.data?.tasks).toHaveLength(100));
      const archiveReads = () =>
        fetchMock.mock.calls.filter(([url]) => String(url).includes('/archive'));
      expect(archiveReads()).toHaveLength(2);
      act(() => result.current.loadMore());
      await waitFor(() => expect(result.current.hasMore).toBe(false));
      act(() => result.current.loadMore());
      expect(archiveReads()).toHaveLength(3);
    });

    it('keeps the rows and offers a retry when the next page fails', async () => {
      const { backend } = withMany();
      const { result } = renderHook(() => useArchivePages(PROJECT_A.id));
      await waitFor(() => expect(result.current.status).toBe('ready'));
      const good = backend.archives?.[PROJECT_A.id];
      backend.archives = { ...backend.archives, [PROJECT_A.id]: 500 };
      act(() => result.current.loadMore());
      await waitFor(() => expect(result.current.loadMoreFailed).toBe(true));
      expect(result.current.data?.tasks).toHaveLength(50);
      expect(result.current.loadingMore).toBe(false);
      backend.archives = { ...backend.archives, [PROJECT_A.id]: good as Task[] };
      act(() => result.current.retryMore());
      await waitFor(() => expect(result.current.data?.tasks).toHaveLength(100));
      expect(result.current.loadMoreFailed).toBe(false);
    });

    it('does not repeat or skip a row when a task is archived between two page reads', async () => {
      const { backend } = withMany();
      const { result } = renderHook(() => useArchivePages(PROJECT_A.id));
      await waitFor(() => expect(result.current.status).toBe('ready'));
      // A newer archive arrives before the next page is read: an offset would repeat #71.
      backend.archives = {
        ...backend.archives,
        [PROJECT_A.id]: [...many(), at(500, '2026-11-01T00:00:00Z')],
      };
      act(() => result.current.loadMore());
      await waitFor(() => expect(result.current.data?.tasks).toHaveLength(100));
      const ids = result.current.data?.tasks.map((task) => task.id) ?? [];
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.slice(0, 3)).toEqual([120, 119, 118]);
      expect(ids.at(-1)).toBe(21);
    });

    it('does not skip a row when a task is restored between two page reads', async () => {
      const { backend } = withMany();
      const { result } = renderHook(() => useArchivePages(PROJECT_A.id));
      await waitFor(() => expect(result.current.status).toBe('ready'));
      // #100 (already read) is restored: an offset would skip #70.
      backend.archives = {
        ...backend.archives,
        [PROJECT_A.id]: many().filter((task) => task.id !== 100),
      };
      act(() => result.current.loadMore());
      await waitFor(() => expect(result.current.data?.tasks).toHaveLength(100));
      const ids = result.current.data?.tasks.map((task) => task.id) ?? [];
      expect(ids).toContain(70);
      expect(ids.at(-1)).toBe(21);
    });

    it('on a live update shows a newly archived row and drops a restored one, keeping the older pages', async () => {
      const { backend } = withMany();
      const { result } = renderHook(() => useArchivePages(PROJECT_A.id));
      await waitFor(() => expect(result.current.status).toBe('ready'));
      act(() => result.current.loadMore());
      await waitFor(() => expect(result.current.data?.tasks).toHaveLength(100));
      backend.archives = {
        ...backend.archives,
        [PROJECT_A.id]: [
          ...many().filter((task) => task.id !== 119),
          at(500, '2026-11-01T00:00:00Z'),
        ],
      };
      act(() => result.current.reload());
      await waitFor(() => expect(result.current.data?.tasks[0]?.id).toBe(500));
      const ids = result.current.data?.tasks.map((task) => task.id) ?? [];
      expect(ids).not.toContain(119);
      expect(ids).toContain(21);
      expect(new Set(ids).size).toBe(ids.length);
      expect(result.current.hasMore).toBe(true);
    });

    it('on a live update leaves no gap between the new rows and the old ones when all were loaded', async () => {
      const { backend } = withMany();
      const { result } = renderHook(() => useArchivePages(PROJECT_A.id));
      await waitFor(() => expect(result.current.status).toBe('ready'));
      act(() => result.current.loadMore());
      await waitFor(() => expect(result.current.data?.tasks).toHaveLength(100));
      act(() => result.current.loadMore());
      await waitFor(() => expect(result.current.hasMore).toBe(false));
      // 60 tasks are archived at once: more than a page lies between the newest and the old rows.
      const fresh = Array.from({ length: 60 }, (_, i) =>
        at(501 + i, new Date(Date.UTC(2026, 10, 1, 0, i)).toISOString()),
      );
      backend.archives = { ...backend.archives, [PROJECT_A.id]: [...many(), ...fresh] };
      act(() => result.current.reload());
      await waitFor(() => expect(result.current.data?.tasks[0]?.id).toBe(560));
      await waitFor(() => expect(result.current.data?.total).toBe(180));
      const ids = result.current.data?.tasks.map((task) => task.id) ?? [];
      // Newest first with no hole: 560..501 then 120 downward, as far as the window reaches.
      const expected = [
        ...Array.from({ length: 60 }, (_, i) => 560 - i),
        ...Array.from({ length: 120 }, (_, i) => 120 - i),
      ];
      expect(ids).toEqual(expected.slice(0, ids.length));
      expect(ids.length).toBeGreaterThanOrEqual(120);
      // Rows that were cut off are still reachable: either the list is whole or more follow.
      expect(ids.length === 180 || result.current.hasMore).toBe(true);
    });

    it('drops a next-page answer that was in flight when a live update replaced the list', async () => {
      const { backend } = withMany();
      const late = deferred<void>();
      let held = false;
      backend.gate = (url) => {
        if (!held && url.includes('cursor=')) {
          held = true;
          return late.promise;
        }
        return undefined;
      };
      const { result } = renderHook(() => useArchivePages(PROJECT_A.id));
      await waitFor(() => expect(result.current.status).toBe('ready'));
      act(() => result.current.loadMore());
      await waitFor(() => expect(result.current.loadingMore).toBe(true));
      // #60 is restored and the list is refreshed while that page is still on its way.
      backend.archives = {
        ...backend.archives,
        [PROJECT_A.id]: many().filter((task) => task.id !== 60),
      };
      act(() => result.current.reload());
      await waitFor(() => expect(result.current.data?.total).toBe(119));
      expect(result.current.loadingMore).toBe(false);
      await act(async () => {
        late.resolve();
        await Promise.resolve();
      });
      await act(async () => Promise.resolve());
      const ids = result.current.data?.tasks.map((task) => task.id) ?? [];
      expect(ids).not.toContain(60);
      expect(result.current.data?.total).toBe(119);
      expect(result.current.loadingMore).toBe(false);
      // The list can still be extended afterwards.
      act(() => result.current.loadMore());
      await waitFor(() => expect(result.current.data?.tasks).toHaveLength(100));
      expect(result.current.data?.tasks.map((task) => task.id)).not.toContain(60);
    });

    it('runs one refresh at a time and follows up once for the updates that came meanwhile', async () => {
      const { backend, fetchMock } = withMany();
      const { result } = renderHook(() => useArchivePages(PROJECT_A.id));
      await waitFor(() => expect(result.current.status).toBe('ready'));
      const gate = deferred<void>();
      let first = true;
      backend.gate = () => {
        if (first) {
          first = false;
          return gate.promise;
        }
        return undefined;
      };
      const reads = () =>
        fetchMock.mock.calls.filter(([url]) => String(url).includes('/archive')).length;
      const before = reads();
      act(() => {
        result.current.reload();
        result.current.reload();
        result.current.reload();
      });
      expect(reads()).toBe(before + 1);
      await act(async () => {
        gate.resolve();
        await Promise.resolve();
      });
      await waitFor(() => expect(reads()).toBe(before + 2));
    });

    it('a superseded refresh of the old project never consumes the new project queued refresh', async () => {
      const lateA = deferred<void>();
      const lateB = deferred<void>();
      const heldA = { done: false };
      const heldB = { done: false };
      const backend = fakeBackend((url) => {
        if (url.includes(PROJECT_A.id) && !heldA.done) {
          heldA.done = true;
          return lateA.promise;
        }
        if (url.includes(PROJECT_B.id) && !heldB.done) {
          heldB.done = true;
          return lateB.promise;
        }
        return undefined;
      });
      const fetchMock = stubBackend(backend);
      const { result, rerender } = renderHook(({ id }) => useArchivePages(id), {
        initialProps: { id: PROJECT_A.id },
      });
      rerender({ id: PROJECT_B.id });
      // B is loading; a live update asks for another read of B.
      act(() => result.current.reload());
      // A's stale answer arrives first.
      await act(async () => {
        lateA.resolve();
        await Promise.resolve();
      });
      await act(async () => {
        lateB.resolve();
        await Promise.resolve();
      });
      await waitFor(() => expect(result.current.data?.project.id).toBe(PROJECT_B.id));
      expect(result.current.data?.tasks.map((task) => task.id)).toEqual([8]);
      expect(result.current.status).toBe('ready');
      // A is not read again on behalf of B.
      const reads = fetchMock.mock.calls.filter(
        ([url]) => String(url).includes(PROJECT_A.id) && String(url).includes('/archive'),
      );
      expect(reads).toHaveLength(1);
    });

    it('reads only the first page when the archive is left and opened again', async () => {
      const { fetchMock } = withMany();
      const archiveReads = () =>
        fetchMock.mock.calls.filter(([url]) => String(url).includes('/archive'));
      const { result, rerender } = renderHook(({ id }) => useArchivePages(id), {
        initialProps: { id: PROJECT_A.id as typeof PROJECT_A.id | null },
      });
      await waitFor(() => expect(result.current.status).toBe('ready'));
      act(() => result.current.loadMore());
      await waitFor(() => expect(result.current.data?.tasks).toHaveLength(100));
      expect(archiveReads()).toHaveLength(2);

      rerender({ id: null });
      expect(result.current.data).toBeNull();
      rerender({ id: PROJECT_A.id });
      await waitFor(() => expect(result.current.status).toBe('ready'));
      await act(async () => Promise.resolve());
      expect(archiveReads()).toHaveLength(3);
      expect(result.current.data?.tasks).toHaveLength(50);
      expect(result.current.hasMore).toBe(true);
    });

    it('re-reads up to the loaded count on a refresh while the archive stays open', async () => {
      const { fetchMock } = withMany();
      const archiveReads = () =>
        fetchMock.mock.calls.filter(([url]) => String(url).includes('/archive'));
      const { result } = renderHook(() => useArchivePages(PROJECT_A.id));
      await waitFor(() => expect(result.current.status).toBe('ready'));
      act(() => result.current.loadMore());
      await waitFor(() => expect(result.current.data?.tasks).toHaveLength(100));
      const before = archiveReads().length;
      act(() => result.current.reload());
      await waitFor(() => expect(archiveReads()).toHaveLength(before + 2));
      expect(result.current.data?.tasks).toHaveLength(100);
    });

    it('drops a removed row at once and counts it out of the total', async () => {
      withMany();
      const { result } = renderHook(() => useArchivePages(PROJECT_A.id));
      await waitFor(() => expect(result.current.status).toBe('ready'));
      act(() => result.current.remove(120));
      expect(result.current.data?.tasks[0]?.id).toBe(119);
      expect(result.current.data?.total).toBe(119);
    });

    it('forgets the pages of the old project when the project changes', async () => {
      withMany();
      const { result, rerender } = renderHook(({ id }) => useArchivePages(id), {
        initialProps: { id: PROJECT_A.id },
      });
      await waitFor(() => expect(result.current.status).toBe('ready'));
      rerender({ id: PROJECT_B.id });
      expect(result.current.data).toBeNull();
      expect(result.current.hasMore).toBe(false);
      await waitFor(() => expect(result.current.data?.project.id).toBe(PROJECT_B.id));
      expect(result.current.data?.tasks.map((task) => task.id)).toEqual([8]);
    });
  });
});
