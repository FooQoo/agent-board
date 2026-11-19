import type { ProjectId } from '../../../shared/api/contracts';
import { ResultsView } from './ResultsView';
import { useTaskResults } from './useTaskResults';

/**
 * The results tab of one task: reads the results while the tab is shown and draws them. `refreshKey`
 * (the number of history entries) reads them again when a delivery lands.
 */
export function ResultsTab({
  projectId,
  taskId,
  active,
  refreshKey,
  attachmentUrl,
  focusVersion,
}: {
  projectId: ProjectId;
  taskId: number;
  active: boolean;
  refreshKey: unknown;
  attachmentUrl: (attachmentId: string) => string;
  focusVersion?: number | null;
}) {
  const results = useTaskResults(projectId, taskId, refreshKey, active);
  return (
    <ResultsView
      state={results}
      refreshFailed={results.refreshFailed}
      attachmentUrl={attachmentUrl}
      focusVersion={focusVersion}
      onRetry={results.retry}
    />
  );
}
