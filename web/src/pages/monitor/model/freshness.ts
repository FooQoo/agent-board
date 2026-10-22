import type { ProjectId } from '../../../shared/api/contracts';
import type { SummaryProblem } from '../../../shared/data/api';
import type { ConnectionState, SectionState } from '../../../shared/data/core';
import type { MonitorFreshness } from '../contracts';

/** How current the list is, from the state of the Summary and of the change notifications. */
export function monitorFreshness(input: {
  state: SectionState;
  hasData: boolean;
  problems: readonly SummaryProblem[];
  projectId: ProjectId;
  stream: ConnectionState;
  lastFetchedAt: string | null;
}): MonitorFreshness {
  const { state, hasData, problems, projectId, stream, lastFetchedAt } = input;
  const snapshotProblems = problems.map((problem) => ({ projectId, ...problem }));
  const make = (next: MonitorFreshness['state']): MonitorFreshness => ({
    state: next,
    lastFetchedAt,
    snapshotProblems,
  });
  if (!hasData) return make(state === 'error' ? 'error' : 'loading');
  // A failed or outdated read leaves the last good list on screen, marked as not current.
  if (state === 'refreshing' || state === 'loading') return make('syncing');
  if (state === 'error' || state === 'stale') return make('stale');
  if (problems.length > 0) return make('partial');
  return make(stream === 'connected' ? 'fresh' : 'stale');
}
