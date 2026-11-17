import { projectPath } from '../../../../shared/api/http';
import type { ProjectId } from '../../../../shared/api/contracts';
import { postTask } from '../../../../shared/api/write';
import { WriteError } from '../../../../shared/api/writeErrors';
import type { Plan } from '../model/plan';

/**
 * Starts an approval: the epic and its AI-draft tasks for an epic's plan, or the one task of a
 * single-task plan. Only a person can; an unanswered question about it makes the server refuse
 * with `start_blocked_by_questions`.
 */
export async function startPlan(projectId: ProjectId, plan: Plan): Promise<void> {
  const base = projectPath(projectId);
  const path =
    plan.epicId === null
      ? `${base}/tasks/${plan.tasks[0]?.id}/start`
      : `${base}/epics/${encodeURIComponent(plan.epicId)}/start`;
  await postTask<unknown>(path, {});
}

/** The questions a `start_blocked_by_questions` refusal names, or `null` for any other failure. */
export function blockingQuestionIds(error: unknown): string[] | null {
  if (!(error instanceof WriteError) || error.code !== 'start_blocked_by_questions') return null;
  return [...new Set(`${error.message} ${error.detail ?? ''}`.match(/Q-\d+/g) ?? [])];
}
