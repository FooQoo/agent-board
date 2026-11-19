import { useCallback, useEffect, useState } from 'react';
import { getJson, projectPath } from '../../../shared/api/http';
import type { ProjectId, TaskResult } from '../../../shared/api/contracts';

export type TaskResultsState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; results: readonly TaskResult[] };

/**
 * Reads a task's results. The Summary and Detail streams do not carry them, so they are read from
 * the results route, and read only while `enabled` (the tab is shown), and read again when `refreshKey` changes (the number of history entries: each
 * delivery adds one).
 */
export function useTaskResults(
  projectId: ProjectId,
  taskId: number,
  refreshKey: unknown,
  enabled = true,
): TaskResultsState & { refreshFailed: boolean; retry: () => void } {
  const [state, setState] = useState<{
    key: string;
    value: TaskResultsState;
    refreshFailed: boolean;
  }>({ key: '', value: { status: 'loading' }, refreshFailed: false });
  const [attempt, setAttempt] = useState(0);
  const identity = `${projectId}/${taskId}`;
  // `refreshKey` and `attempt` only make the read run again.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    getJson<{ results: TaskResult[] }>(`${projectPath(projectId)}/tasks/${taskId}/results`).then(
      (body) => {
        if (live)
          setState({
            key: identity,
            value: { status: 'ready', results: body.results },
            refreshFailed: false,
          });
      },
      () => {
        // A failed read keeps what was shown for this task and says that the refresh failed.
        if (live)
          setState((current) =>
            current.key === identity && current.value.status === 'ready'
              ? { ...current, refreshFailed: true }
              : { key: identity, value: { status: 'error' }, refreshFailed: false },
          );
      },
    );
    return () => {
      live = false;
    };
  }, [projectId, taskId, identity, refreshKey, attempt, enabled]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const value: TaskResultsState = state.key === identity ? state.value : { status: 'loading' };
  return { ...value, refreshFailed: state.key === identity && state.refreshFailed, retry };
}
