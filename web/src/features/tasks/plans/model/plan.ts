import type { Assignee } from '../../../../shared/api/contracts';
import type { Message, Summary } from '../../../../shared/data/api';

/** A task a plan starts, with what the review shows of it. */
export interface PlanTask {
  id: number;
  title: string;
  assignee: Assignee;
  /** How many acceptance conditions the task has. */
  acceptance: number;
}

/** An unanswered question that blocks a plan. */
export interface PlanQuestion {
  id: string;
  title: string;
}

/**
 * An approval as the board shows it: one plan card in Todo, and one review.
 *
 * - `new`: the epic itself is an AI draft, and its AI-draft tasks start with it.
 * - `added`: AI-draft tasks were added to an epic that is already running.
 * - `single`: one AI-draft task that belongs to no draft epic.
 */
export interface Plan {
  /** The approval's ID: the epic's ID, or `#<task id>` for a single task. */
  id: string;
  kind: 'new' | 'added' | 'single';
  epicId: string | null;
  epicName: string;
  /** The tasks that start, in the order the server lists them. */
  tasks: PlanTask[];
  /** The open questions that name the epic or one of the tasks. */
  questions: PlanQuestion[];
}

/** The text a plan card and the review title show. */
export function planTitle(plan: Plan): string {
  if (plan.kind === 'single') return plan.tasks[0]?.title ?? plan.id;
  return `${plan.epicId} ${plan.epicName}`;
}

/** A card the lanes do not draw by itself: an AI draft is shown through its plan. */
export function isAiDraft(task: { draft: string | null }): boolean {
  return task.draft === 'ai';
}

/** The plans of a Summary: one for each approval that still waits for a person. */
export function plansOfSummary(summary: Pick<Summary, 'tasks' | 'epics' | 'messages'>): Plan[] {
  const messages = summary.messages ?? [];
  const questions = messages.filter(
    (message) => message.type === 'question' && message.turn === 'human',
  );
  const plans: Plan[] = [];
  for (const approval of messages) {
    if (approval.type !== 'approval' || approval.turn !== 'human') continue;
    const tasks: PlanTask[] = [];
    for (const id of approval.tasks) {
      const task = summary.tasks.find((item) => item.id === id);
      if (task) {
        tasks.push({
          id: task.id,
          title: task.title,
          assignee: task.assignee,
          acceptance: task.acceptance.total,
        });
      }
    }
    const epic =
      approval.epicId === null
        ? undefined
        : summary.epics.find((item) => item.id === approval.epicId);
    const blocking = questions.filter(
      (question) =>
        (approval.epicId !== null && question.epicId === approval.epicId) ||
        question.tasks.some((id) => approval.tasks.includes(id)),
    );
    plans.push({
      id: approval.id,
      kind: approval.epicId === null ? 'single' : epic?.draft === 'ai' ? 'new' : 'added',
      epicId: approval.epicId,
      epicName: epic?.name ?? approval.title,
      tasks,
      questions: blocking.map(({ id, title }) => ({ id, title })),
    });
  }
  return plans;
}

/** The plan an approval message stands for, or `null` once the approval is gone. */
export function planOfApproval(
  plans: readonly Plan[],
  approval: Pick<Message, 'id'> | string,
): Plan | null {
  const id = typeof approval === 'string' ? approval : approval.id;
  return plans.find((plan) => plan.id === id) ?? null;
}
