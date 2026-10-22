import { useCallback, useEffect, useState } from 'react';
import { FetchError } from '../../../shared/api/http';
import type { ProjectId } from '../../../shared/api/contracts';
import type { Summary } from '../../../shared/data/api';
import { useSummary } from '../../../shared/data/react';

export interface UseBoardResult {
  status: 'loading' | 'ready' | 'error';
  /** The Summary of the project; `null` while it is loading or when it cannot be shown. */
  summary: Summary | null;
  /** Why the board is not shown: the project does not exist, or the request failed. */
  error: 'not_found' | 'failed' | null;
  /** True when the last fetch failed. A ready board stays on screen. */
  fetchFailed: boolean;
  /** When this browser last fetched the Summary successfully. */
  lastSyncedAt: Date | null;
  /** Reads the Summary again now; the presentation hold does not delay it. */
  reload: () => void;
}

/**
 * The Summary of one project, from the data layer. The result belongs to `projectId` only: the
 * cache is keyed by project, so switching shows the new project's own Summary and a late answer
 * for another project never lands here.
 */
export function useBoard(projectId: ProjectId | null): UseBoardResult {
  const { state, summary, error, refresh } = useSummary(projectId);
  const [syncedAt, setSyncedAt] = useState<{ projectId: ProjectId | null; at: Date } | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new Summary object is a new fetch
  useEffect(() => {
    if (state === 'ready') setSyncedAt({ projectId, at: new Date() });
  }, [state, summary, projectId]);

  const notFound = error instanceof FetchError && error.projectNotFound;
  let status: UseBoardResult['status'] = 'loading';
  if (notFound) status = 'error';
  else if (summary !== null) status = 'ready';
  else if (state === 'error') status = 'error';

  const reload = useCallback(() => {
    void refresh();
  }, [refresh]);

  return {
    status,
    summary: notFound ? null : summary,
    error: notFound ? 'not_found' : status === 'error' ? 'failed' : null,
    fetchFailed: error !== null,
    lastSyncedAt: syncedAt?.projectId === projectId && status === 'ready' ? syncedAt.at : null,
    reload,
  };
}
