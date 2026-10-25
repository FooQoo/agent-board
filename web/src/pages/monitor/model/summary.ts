import type { AcceptanceItem, EpicRef, Task } from '../../../shared/api/contracts';
import type { Summary, SummaryTask } from '../../../shared/data/api';
import type { MonitorTask } from '../contracts';

/** An epic that the Summary does not list is still shown by its ID, in a neutral color. */
const UNLISTED_EPIC_COLOR = '#808080';

/**
 * The count only: the Summary never carries the conditions' text, so the card gets one item per
 * condition with its done flag. The text arrives with the `document` section when a drawer opens.
 */
function acceptanceOf(task: SummaryTask): AcceptanceItem[] {
  const { done, total } = task.acceptance;
  return Array.from({ length: total }, (_, index) => ({
    id: `AC-${index + 1}`,
    text: '',
    done: index < done,
  }));
}

function taskOf(task: SummaryTask, epics: ReadonlyMap<string, EpicRef>): Task {
  const epic =
    task.epicId === null
      ? null
      : (epics.get(task.epicId) ?? {
          id: task.epicId,
          name: task.epicId,
          color: UNLISTED_EPIC_COLOR,
        });
  return {
    id: task.id,
    title: task.title,
    description: '',
    body: '',
    acceptance: acceptanceOf(task),
    acceptanceError: false,
    assignee: task.assignee,
    taskStatus: task.taskStatus,
    taskStatusChangedAt: task.taskStatusChangedAt,
    position: task.position,
    agentStatus: task.agentStatus,
    pendingReason: task.pendingReason,
    pendingRequestId: task.pendingRequestId,
    pendingChoices: task.pendingChoices,
    epic,
    // The Summary has no creation time; the time the card entered its lane stands in for it.
    createdAt: task.taskStatusChangedAt,
    updatedAt: task.updatedAt,
    agentStatusChangedAt: task.agentStatusChangedAt,
    isDraft: task.isDraft,
    history: [],
    attachments: [],
  };
}

/** The monitor's cards for one project, drawn from its Summary alone. */
export function monitorTasksOf(summary: Summary): MonitorTask[] {
  const epics = new Map<string, EpicRef>(
    summary.epics.map((epic) => [epic.id, { id: epic.id, name: epic.name, color: epic.color }]),
  );
  return summary.tasks.map((task) => ({
    projectId: summary.project.id,
    projectName: summary.project.name,
    task: taskOf(task, epics),
  }));
}
