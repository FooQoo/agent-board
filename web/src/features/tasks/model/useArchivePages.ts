import { useCallback, useEffect, useRef, useState } from 'react';
import { FetchError } from '../../../shared/api/http';
import type { Epic, ProjectId } from '../../../shared/api/contracts';
import {
  type ArchivePage,
  type ArchiveResponse,
  type ArchivedTask,
  compareArchivedNewestFirst,
  fetchArchivePage,
} from '../api/read';

export interface ArchivePages {
  status: 'loading' | 'ready' | 'error';
  /** The pages read so far, joined; `null` until the first page arrives. */
  data: ArchiveResponse | null;
  error: 'not_found' | 'failed' | null;
  /** A refresh of the newest page failed, but the rows shown are from the last good read. */
  fetchFailed: boolean;
  lastSyncedAt: Date | null;
  /** More pages follow the rows shown. */
  hasMore: boolean;
  loadingMore: boolean;
  /** The last request for the next page failed; `loadMore` or `retryMore` asks again. */
  loadMoreFailed: boolean;
  /** Asks for the next page; ignored while one is on its way or after the last. */
  loadMore: () => void;
  /** Asks again after a failure of the next page. */
  retryMore: () => void;
  /** Reads the newest page again and keeps the older rows already read (a live update). */
  reload: () => void;
  /** Drops a row at once (it was restored here); the archive is not read again. */
  remove: (id: number) => void;
}

interface State {
  projectId: ProjectId | null;
  status: ArchivePages['status'];
  data: ArchiveResponse | null;
  nextCursor: string | null;
  error: ArchivePages['error'];
  fetchFailed: boolean;
  lastSyncedAt: Date | null;
  loadingMore: boolean;
  loadMoreFailed: boolean;
}

const empty = (projectId: ProjectId | null): State => ({
  projectId,
  status: 'loading',
  data: null,
  nextCursor: null,
  error: null,
  fetchFailed: false,
  lastSyncedAt: null,
  loadingMore: false,
  loadMoreFailed: false,
});

function uniqueEpics(...lists: Epic[][]): Epic[] {
  const byId = new Map<string, Epic>();
  for (const epic of lists.flat()) byId.set(epic.id, epic);
  return [...byId.values()];
}

/** Rows joined and sorted, a row that appears twice kept once (the later copy wins). */
function join(rows: ArchivedTask[]): ArchivedTask[] {
  const byId = new Map<number, ArchivedTask>();
  for (const row of rows) byId.set(row.id, row);
  return [...byId.values()].sort(compareArchivedNewestFirst);
}

/** A page that comes after the rows already read: its rows are appended. */
function appendPage(previous: State, page: ArchivePage): State {
  const before = previous.data;
  return {
    ...previous,
    status: 'ready',
    data: {
      ...page,
      tasks: join([...(before?.tasks ?? []), ...page.tasks]),
      epics: uniqueEpics(before?.epics ?? [], page.epics),
      total: before ? Math.max(page.total, before.total) : page.total,
    },
    nextCursor: page.nextCursor,
  };
}

/**
 * The loaded window read again, from the newest page on, replaces the old rows in one step: an
 * archived row appears, a restored one leaves, and no gap can open between the new rows and the old.
 */
function swapWindow(previous: State, pages: ArchivePage[]): State {
  const first = pages[0] as ArchivePage;
  const last = pages[pages.length - 1] as ArchivePage;
  return {
    ...previous,
    status: 'ready',
    error: null,
    fetchFailed: false,
    lastSyncedAt: new Date(),
    loadingMore: false,
    loadMoreFailed: false,
    data: {
      ...first,
      tasks: join(pages.flatMap((page) => page.tasks)),
      epics: uniqueEpics(...pages.map((page) => page.epics)),
    },
    nextCursor: last.nextCursor,
  };
}

/**
 * The archive of a project, read a page at a time. Rows are kept newest first with no duplicates, so
 * a task archived or restored between two page reads never shows twice (the cursor is a keyset: it
 * names the last row read, not an offset). Used by the PC list and the phone sheet. Only the newest
 * response for the shown project is applied.
 */
export function useArchivePages(projectId: ProjectId | null): ArchivePages {
  const [state, setState] = useState<State>(() => empty(projectId));
  // Bumped when the project changes and when a refresh starts: an older response is then dropped.
  const generation = useRef(0);
  const projectRef = useRef(projectId);
  const stateRef = useRef(state);
  stateRef.current = state;
  const moreInFlight = useRef(false);
  const refreshing = useRef(false);
  const refreshAgain = useRef(false);

  /** Reads from the newest page on until the rows already loaded are covered, then swaps them in. */
  const refresh = useCallback(async (target: ProjectId) => {
    if (refreshing.current) {
      refreshAgain.current = true;
      return;
    }
    refreshing.current = true;
    try {
      do {
        refreshAgain.current = false;
        const mine = ++generation.current;
        // A next-page read of the old window is dropped now, so it is no longer in flight.
        moreInFlight.current = false;
        const current = stateRef.current;
        const wanted = current.projectId === target ? (current.data?.tasks.length ?? 0) : 0;
        try {
          const pages: ArchivePage[] = [];
          let cursor: string | null = null;
          let rows = 0;
          do {
            const page: ArchivePage = await fetchArchivePage(target, cursor);
            if (mine !== generation.current) break;
            pages.push(page);
            rows += page.tasks.length;
            cursor = page.nextCursor;
          } while (cursor !== null && rows < wanted);
          if (mine !== generation.current || pages.length === 0) continue;
          if (pages[0]?.project.id !== target) continue;
          setState((previous) =>
            previous.projectId === target ? swapWindow(previous, pages) : previous,
          );
        } catch (cause) {
          if (mine !== generation.current) continue;
          const notFound = cause instanceof FetchError && cause.projectNotFound;
          setState((previous) =>
            previous.projectId === target && previous.data && !notFound
              ? { ...previous, fetchFailed: true }
              : {
                  ...empty(target),
                  status: 'error',
                  error: notFound ? 'not_found' : 'failed',
                  fetchFailed: true,
                },
          );
        }
      } while (refreshAgain.current);
    } finally {
      refreshing.current = false;
    }
  }, []);

  useEffect(() => {
    projectRef.current = projectId;
    moreInFlight.current = false;
    refreshing.current = false;
    refreshAgain.current = false;
    if (projectId === null) return;
    setState(empty(projectId));
    void refresh(projectId);
    return () => {
      generation.current++;
    };
  }, [projectId, refresh]);

  const loadMore = useCallback(() => {
    const target = projectRef.current;
    const current = stateRef.current;
    if (target === null || current.projectId !== target || moreInFlight.current) return;
    if (refreshing.current || current.status !== 'ready' || current.nextCursor === null) return;
    const mine = generation.current;
    moreInFlight.current = true;
    setState((previous) => ({ ...previous, loadingMore: true, loadMoreFailed: false }));
    fetchArchivePage(target, current.nextCursor).then(
      (page) => {
        if (mine !== generation.current) return;
        moreInFlight.current = false;
        setState((previous) =>
          previous.projectId === target
            ? { ...appendPage(previous, page), loadingMore: false, loadMoreFailed: false }
            : previous,
        );
      },
      () => {
        if (mine !== generation.current) return;
        moreInFlight.current = false;
        setState((previous) => ({ ...previous, loadingMore: false, loadMoreFailed: true }));
      },
    );
  }, []);

  const reload = useCallback(() => {
    const target = projectRef.current;
    if (target === null) return;
    setState((previous) =>
      previous.projectId === target && previous.status === 'error' ? empty(target) : previous,
    );
    void refresh(target);
  }, [refresh]);

  const remove = useCallback((id: number) => {
    setState((previous) => {
      const data = previous.data;
      if (!data?.tasks.some((row) => row.id === id)) return previous;
      return {
        ...previous,
        data: {
          ...data,
          tasks: data.tasks.filter((row) => row.id !== id),
          total: Math.max(0, data.total - 1),
        },
      };
    });
  }, []);

  const view = state.projectId === projectId ? state : empty(projectId);
  return {
    status: view.status,
    data: view.data,
    error: view.error,
    fetchFailed: view.fetchFailed,
    lastSyncedAt: view.lastSyncedAt,
    hasMore: view.nextCursor !== null,
    loadingMore: view.loadingMore,
    loadMoreFailed: view.loadMoreFailed,
    loadMore,
    retryMore: loadMore,
    reload,
    remove,
  };
}
