import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchProjects } from '../api';
import type { Project } from '../../../shared/api/contracts';

export interface UseProjectsResult {
  /** `loading` and `error` last until the first list arrives; a later failure keeps the old list. */
  status: 'loading' | 'ready' | 'error';
  projects: Project[];
  catalogVersion: string | null;
  /** True when the last fetch failed. */
  fetchFailed: boolean;
  reload: () => void;
}

/** Loads the project list. Only the latest request is applied, including after a StrictMode remount. */
export function useProjects(): UseProjectsResult {
  const [state, setState] = useState<Omit<UseProjectsResult, 'reload'>>({
    status: 'loading',
    projects: [],
    catalogVersion: null,
    fetchFailed: false,
  });
  const generation = useRef(0);

  const load = useCallback(() => {
    const mine = ++generation.current;
    fetchProjects().then(
      (list) => {
        if (mine !== generation.current) return;
        setState({
          status: 'ready',
          projects: list.projects,
          catalogVersion: list.catalogVersion,
          fetchFailed: false,
        });
      },
      () => {
        if (mine !== generation.current) return;
        setState((previous) =>
          previous.status === 'ready'
            ? { ...previous, fetchFailed: true }
            : { ...previous, status: 'error', fetchFailed: true },
        );
      },
    );
  }, []);

  useEffect(() => {
    load();
    return () => {
      generation.current++;
    };
  }, [load]);

  const reload = useCallback(() => {
    setState((previous) =>
      previous.status === 'error' ? { ...previous, status: 'loading' } : previous,
    );
    load();
  }, [load]);

  return { ...state, reload };
}
