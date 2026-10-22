import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type { ProjectId } from '../../api/contracts';
import type { Summary } from '../api/contracts';
import type { SectionState } from '../core/types';
import { useDataCore } from './provider';

export interface UseSummaryResult {
  state: SectionState;
  summary: Summary | null;
  error: Error | null;
  /** Asks the server again now; the presentation hold does not delay it. */
  refresh(): Promise<void>;
}

/** The Summary of a project, kept current by the change notifications while this is mounted. */
export function useSummary(projectId: ProjectId | null): UseSummaryResult {
  const core = useDataCore();
  useEffect(
    () => (projectId === null ? undefined : core.watchProject(projectId)),
    [core, projectId],
  );
  const snapshot = useSyncExternalStore(core.store.subscribe, () =>
    core.store.getSummary(projectId ?? ''),
  );
  const refresh = useCallback(
    () => (projectId === null ? Promise.resolve() : core.refreshSummary(projectId)),
    [core, projectId],
  );
  return { state: snapshot.state, summary: snapshot.data, error: snapshot.error, refresh };
}
