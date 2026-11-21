import { resultLinkQuery, resultsTabLinkQuery } from '../results/resultLink';
import type { SummaryResult } from './model/messages';

/**
 * Where a result line of a summary leads: the task's Results tab, scrolled to that version and
 * highlighted (the same link a notification carries). A line without a version opens the tab
 * without a highlight. This is the one place that decides the destination.
 *
 * Gives nothing when the project or the task is not a valid link target.
 */
export function summaryResultHref(projectId: string, result: SummaryResult): string | null {
  return result.version === null
    ? resultsTabLinkQuery(projectId, result.taskId)
    : resultLinkQuery(projectId, result.taskId, result.version);
}
