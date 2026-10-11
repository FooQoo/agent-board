import { useCallback, useEffect, useRef, useState } from 'react';
import { monitorClient } from '../client';
import type { MonitorCard, MonitorFreshness, MonitorFreshnessState } from '../contracts';
import type { Board, Project, ProjectId, ProjectList } from '../../types';

const BOARD_CONCURRENCY = 4;
const CATALOG_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000] as const;

export interface MonitorReadApi {
  fetchCatalog(options?: { signal?: AbortSignal }): Promise<ProjectList>;
  fetchBoard(projectId: ProjectId, options?: { signal?: AbortSignal }): Promise<Board>;
}

interface MonitorSnapshot {
  projects: Project[];
  cards: MonitorCard[];
  projectVersions: Record<ProjectId, string>;
  failedProjectIds: ProjectId[];
  snapshotProblems: Array<MonitorFreshness['snapshotProblems'][number]>;
  catalogVersion: string | null;
  status: 'loading' | 'syncing' | 'fresh' | 'partial' | 'stale' | 'error';
  hasSnapshot: boolean;
  catalogReady: boolean;
  lastFullFetchedAt: string | null;
}

export interface UseMonitorOptions {
  api?: MonitorReadApi;
  now?: () => Date;
}

export interface UseMonitorResult {
  projects: Project[];
  cards: MonitorCard[];
  projectVersions: Record<ProjectId, string>;
  catalogVersion: string | null;
  catalogReady: boolean;
  hasSnapshot: boolean;
  freshness: MonitorFreshness;
  refresh(): void;
  onVisibility(visible: boolean): void;
}

const initialSnapshot: MonitorSnapshot = {
  projects: [],
  cards: [],
  projectVersions: {},
  failedProjectIds: [],
  snapshotProblems: [],
  catalogVersion: null,
  status: 'loading',
  hasSnapshot: false,
  catalogReady: false,
  lastFullFetchedAt: null,
};

async function mapLimit<T, R>(items: readonly T[], limit: number, task: (item: T) => Promise<R>) {
  const result = new Array<R>(items.length);
  let index = 0;
  const worker = async () => {
    while (index < items.length) {
      const current = index++;
      const item = items[current];
      if (item === undefined) continue;
      result[current] = await task(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return result;
}

function isAbort(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === 'AbortError';
}

async function readSnapshot(api: MonitorReadApi, signal: AbortSignal) {
  for (let attempt = 0; attempt < CATALOG_ATTEMPTS; attempt++) {
    const before = await api.fetchCatalog({ signal });
    const fetched = await mapLimit(before.projects, BOARD_CONCURRENCY, async (project) => {
      try {
        const board = await api.fetchBoard(project.id, { signal });
        if (board.project.id !== project.id)
          throw new Error('Monitor board project did not match catalog.');
        return { project, board, error: null };
      } catch (error) {
        return { project, board: null, error };
      }
    });
    const after = await api.fetchCatalog({ signal });
    if (before.catalogVersion !== after.catalogVersion) continue;

    const cards: MonitorCard[] = [];
    const projectVersions: Record<ProjectId, string> = {};
    const failedProjectIds: ProjectId[] = [];
    const snapshotProblems: MonitorSnapshot['snapshotProblems'] = [];
    for (const entry of fetched) {
      if (!entry.board) {
        failedProjectIds.push(entry.project.id);
        continue;
      }
      projectVersions[entry.project.id] = entry.board.version;
      cards.push(
        ...entry.board.cards.map((card) => ({
          projectId: entry.project.id,
          projectName: entry.project.name,
          card,
        })),
      );
      snapshotProblems.push(
        ...entry.board.problems.map((problem) => ({ projectId: entry.project.id, ...problem })),
      );
    }
    return {
      projects: after.projects,
      catalogVersion: after.catalogVersion,
      cards,
      projectVersions,
      failedProjectIds,
      snapshotProblems,
      partial: failedProjectIds.length > 0 || snapshotProblems.length > 0,
    };
  }
  throw new Error('The monitor catalog kept changing while its boards were being fetched.');
}

export function useMonitor({
  api = monitorClient,
  now = () => new Date(),
}: UseMonitorOptions = {}): UseMonitorResult {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const suspendedRef = useRef(document.visibilityState === 'hidden');
  const apiRef = useRef(api);
  const nowRef = useRef(now);
  apiRef.current = api;
  nowRef.current = now;
  const generation = useRef(0);
  const active = useRef<AbortController | null>(null);
  const dirty = useRef(false);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryIndex = useRef(0);
  const startRef = useRef<() => void>(() => {});

  const clearRetry = useCallback(() => {
    if (retryTimer.current !== null) clearTimeout(retryTimer.current);
    retryTimer.current = null;
  }, []);

  const queueRetry = useCallback(() => {
    if (suspendedRef.current || retryTimer.current !== null) return;
    const delay =
      RETRY_DELAYS_MS[Math.min(retryIndex.current, RETRY_DELAYS_MS.length - 1)] ?? 30_000;
    retryIndex.current = Math.min(retryIndex.current + 1, RETRY_DELAYS_MS.length - 1);
    retryTimer.current = setTimeout(() => {
      retryTimer.current = null;
      startRef.current();
    }, delay);
  }, []);

  const start = useCallback(() => {
    if (suspendedRef.current) return;
    if (active.current) {
      dirty.current = true;
      return;
    }
    const controller = new AbortController();
    active.current = controller;
    const mine = ++generation.current;
    setSnapshot((previous) => ({
      ...previous,
      status: previous.hasSnapshot ? 'syncing' : 'loading',
    }));

    void readSnapshot(apiRef.current, controller.signal)
      .then(
        (result) => {
          if (mine !== generation.current || controller.signal.aborted) return;
          retryIndex.current = 0;
          setSnapshot((previous) => ({
            ...previous,
            projects: result.projects,
            cards: result.cards,
            projectVersions: result.projectVersions,
            failedProjectIds: result.failedProjectIds,
            snapshotProblems: result.snapshotProblems,
            catalogVersion: result.catalogVersion,
            status: result.partial ? 'partial' : 'fresh',
            hasSnapshot: true,
            catalogReady: true,
            lastFullFetchedAt: result.partial
              ? previous.lastFullFetchedAt
              : nowRef.current().toISOString(),
          }));
          if (result.failedProjectIds.length > 0) queueRetry();
        },
        (cause: unknown) => {
          if (mine !== generation.current || controller.signal.aborted || isAbort(cause)) return;
          setSnapshot((previous) => ({
            ...previous,
            status: previous.hasSnapshot ? 'stale' : 'error',
            catalogReady: previous.catalogReady,
          }));
          queueRetry();
        },
      )
      .finally(() => {
        if (active.current === controller) active.current = null;
        if (mine !== generation.current || suspendedRef.current) return;
        if (dirty.current) {
          dirty.current = false;
          clearRetry();
          startRef.current();
        }
      });
  }, [clearRetry, queueRetry]);
  startRef.current = start;

  const refresh = useCallback(() => {
    if (suspendedRef.current) return;
    clearRetry();
    retryIndex.current = 0;
    startRef.current();
  }, [clearRetry]);

  const onVisibility = useCallback(
    (visible: boolean) => {
      suspendedRef.current = !visible;
      if (!visible) {
        clearRetry();
        dirty.current = false;
        generation.current++;
        active.current?.abort();
        active.current = null;
        setSnapshot((previous) => ({
          ...previous,
          status: previous.hasSnapshot ? 'stale' : previous.status,
        }));
      } else {
        refresh();
      }
    },
    [clearRetry, refresh],
  );

  useEffect(() => {
    if (!suspendedRef.current) startRef.current();
    return () => {
      clearRetry();
      generation.current++;
      active.current?.abort();
      active.current = null;
    };
  }, [clearRetry]);

  const state: MonitorFreshnessState = snapshot.status;
  return {
    projects: snapshot.projects,
    cards: snapshot.cards,
    projectVersions: snapshot.projectVersions,
    catalogVersion: snapshot.catalogVersion,
    catalogReady: snapshot.catalogReady,
    hasSnapshot: snapshot.hasSnapshot,
    freshness: {
      state,
      lastFetchedAt: snapshot.lastFullFetchedAt,
      failedProjectIds: snapshot.failedProjectIds,
      snapshotProblems: snapshot.snapshotProblems,
    },
    refresh,
    onVisibility,
  };
}

export function monitorFreshnessForStream(
  freshness: MonitorFreshness,
  stream: 'connecting' | 'connected' | 'disconnected' | 'hidden',
): MonitorFreshness {
  if (freshness.state === 'loading' || freshness.state === 'syncing' || freshness.state === 'error')
    return freshness;
  if (stream === 'connected') return freshness;
  return { ...freshness, state: 'stale' };
}
