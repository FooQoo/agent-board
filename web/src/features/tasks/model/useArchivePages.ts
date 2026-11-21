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

/** The reads of one shown project; see `useArchivePages`. */
interface Session {
  target: ProjectId;
  /** Counts the refresh passes; a read that started in an earlier pass is dropped. */
  generation: number;
  refreshing: boolean;
  refreshAgain: boolean;
  moreInFlight: boolean;
  /** The project is no longer shown: nothing started by this session may change anything. */
  dead: boolean;
}

/**
 * The archive of a project, read a page at a time. Rows are kept newest first with no duplicates, so
 * a task archived or restored between two page reads never shows twice (the cursor is a keyset: it
 * names the last row read, not an offset). Used by the PC list and the phone sheet. Only the newest
 * response for the shown project is applied.
 */
export function useArchivePages(projectId: ProjectId | null): ArchivePages {
  const [state, setState] = useState<State>(() => empty(projectId));
  // Everything an in-flight read may touch lives in the session of one shown project. A project
  // change ends the session (`dead`) and starts another, so a read that outlives its project can
  // change neither the new project's flags nor its state.
  const session = useRef<Session | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  /** Reads from the newest page on until the rows already loaded are covered, then swaps them in. */
  const refresh = useCallback(async (mine: Session) => {
    if (mine.dead) return;
    if (mine.refreshing) {
      mine.refreshAgain = true;
      return;
    }
    mine.refreshing = true;
    try {
      while (!mine.dead) {
        mine.refreshAgain = false;
        const pass = ++mine.generation;
        // A next-page read of the old window is dropped now, so it is no longer in flight.
        mine.moreInFlight = false;
        const target = mine.target;
        const current = stateRef.current;
        const wanted = current.projectId === target ? (current.data?.tasks.length ?? 0) : 0;
        const superseded = () => mine.dead || pass !== mine.generation;
        try {
          const pages: ArchivePage[] = [];
          let cursor: string | null = null;
          let rows = 0;
          do {
            const page: ArchivePage = await fetchArchivePage(target, cursor);
            if (superseded()) return;
            pages.push(page);
            rows += page.tasks.length;
            cursor = page.nextCursor;
          } while (cursor !== null && rows < wanted);
          const answered = pages[0]?.project.id === target;
          setState((previous) => {
            if (previous.projectId !== target) return previous;
            // An answer for another project is ignored, but the dropped next-page read is not "loading".
            return answered ? swapWindow(previous, pages) : { ...previous, loadingMore: false };
          });
        } catch (cause) {
          if (superseded()) return;
          const notFound = cause instanceof FetchError && cause.projectNotFound;
          setState((previous) =>
            previous.projectId === target && previous.data && !notFound
              ? { ...previous, fetchFailed: true, loadingMore: false }
              : {
                  ...empty(target),
                  status: 'error',
                  error: notFound ? 'not_found' : 'failed',
                  fetchFailed: true,
                },
          );
        }
        if (!mine.refreshAgain) return;
      }
    } finally {
      mine.refreshing = false;
    }
  }, []);

  useEffect(() => {
    // Leaving the archive, or showing another project, discards the rows and the loaded count: the
    // first read of the next session covers only the first page. `stateRef` is reset here too, as
    // the first read starts before the next render refreshes it.
    const fresh = empty(projectId);
    stateRef.current = fresh;
    setState(fresh);
    if (projectId === null) {
      session.current = null;
      return;
    }
    const mine: Session = {
      target: projectId,
      generation: 0,
      refreshing: false,
      refreshAgain: false,
      moreInFlight: false,
      dead: false,
    };
    session.current = mine;
    void refresh(mine);
    return () => {
      mine.dead = true;
    };
  }, [projectId, refresh]);

  const loadMore = useCallback(() => {
    const mine = session.current;
    const current = stateRef.current;
    if (mine === null || mine.dead || current.projectId !== mine.target) return;
    if (mine.moreInFlight || mine.refreshing) return;
    if (current.status !== 'ready' || current.nextCursor === null) return;
    const pass = mine.generation;
    const target = mine.target;
    const superseded = () => mine.dead || pass !== mine.generation;
    mine.moreInFlight = true;
    setState((previous) => ({ ...previous, loadingMore: true, loadMoreFailed: false }));
    fetchArchivePage(target, current.nextCursor).then(
      (page) => {
        if (superseded()) return;
        mine.moreInFlight = false;
        setState((previous) =>
          previous.projectId === target
            ? { ...appendPage(previous, page), loadingMore: false, loadMoreFailed: false }
            : previous,
        );
      },
      () => {
        if (superseded()) return;
        mine.moreInFlight = false;
        setState((previous) =>
          previous.projectId === target
            ? { ...previous, loadingMore: false, loadMoreFailed: true }
            : previous,
        );
      },
    );
  }, []);

  const reload = useCallback(() => {
    const mine = session.current;
    if (mine === null || mine.dead) return;
    const target = mine.target;
    setState((previous) =>
      previous.projectId === target && previous.status === 'error' ? empty(target) : previous,
    );
    void refresh(mine);
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
