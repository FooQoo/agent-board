import { useCallback, useEffect, useRef, useState } from 'react';
import { FetchError } from '../api';
import type { ProjectId } from '../types';

export interface ProjectResourceResult<T> {
  status: 'loading' | 'ready' | 'error';
  data: T | null;
  error: 'not_found' | 'failed' | null;
  fetchFailed: boolean;
  lastSyncedAt: Date | null;
  reload: () => void;
}

interface Slot<T> extends Omit<ProjectResourceResult<T>, 'reload'> {
  projectId: ProjectId | null;
}

function loadingSlot<T>(projectId: ProjectId | null): Slot<T> {
  return {
    projectId,
    status: 'loading',
    data: null,
    error: null,
    fetchFailed: false,
    lastSyncedAt: null,
  };
}

/** Loads a project-scoped resource and applies only the newest response for the visible project. */
export function useProjectResource<T extends { project: { id: ProjectId } }>(
  projectId: ProjectId | null,
  fetcher: (projectId: ProjectId) => Promise<T>,
): ProjectResourceResult<T> {
  const [slot, setSlot] = useState<Slot<T>>(() => loadingSlot(projectId));
  const generation = useRef(0);
  const current = useRef(projectId);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const load = useCallback((target: ProjectId) => {
    const mine = ++generation.current;
    fetcherRef.current(target).then(
      (data) => {
        if (mine !== generation.current || data.project.id !== target) return;
        setSlot({
          projectId: target,
          status: 'ready',
          data,
          error: null,
          fetchFailed: false,
          lastSyncedAt: new Date(),
        });
      },
      (cause: unknown) => {
        if (mine !== generation.current) return;
        const notFound = cause instanceof FetchError && cause.projectNotFound;
        setSlot((previous) =>
          previous.projectId === target && previous.status === 'ready' && !notFound
            ? { ...previous, fetchFailed: true }
            : {
                projectId: target,
                status: 'error',
                data: null,
                error: notFound ? 'not_found' : 'failed',
                fetchFailed: true,
                lastSyncedAt: null,
              },
        );
      },
    );
  }, []);

  useEffect(() => {
    current.current = projectId;
    if (projectId === null) return;
    setSlot(loadingSlot(projectId));
    load(projectId);
    return () => {
      generation.current++;
    };
  }, [projectId, load]);

  const view = slot.projectId === projectId ? slot : loadingSlot<T>(projectId);
  const reload = useCallback(() => {
    const target = current.current;
    if (target === null) return;
    setSlot((previous) =>
      previous.projectId === target && previous.status === 'error' ? loadingSlot(target) : previous,
    );
    load(target);
  }, [load]);

  return {
    status: view.status,
    data: view.data,
    error: view.error,
    fetchFailed: view.fetchFailed,
    lastSyncedAt: view.lastSyncedAt,
    reload,
  };
}
