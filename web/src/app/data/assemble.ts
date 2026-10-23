import type {
  Epic,
  EpicRef,
  EpicTaskCounts,
  Problem,
  Task,
  TaskSummary,
} from '../../shared/api/contracts';
import type { Summary, SummaryEpic, SummaryProject, SummaryTask } from '../../shared/data/api';
import type { DocumentData } from '../../shared/data/core';

/**
 * What the app builds from the data layer. The list shows `TaskSummary` cards made from the
 * Summary. The detail drawer, the epic screen and the archive read their Detail themselves; only
 * the editing dialogs, which take a whole `Task` or `Epic`, are given one built here.
 */

/** What the board shows of a project, taken from its Summary. */
export interface BoardView {
  project: SummaryProject;
  version: string;
  tasks: TaskSummary[];
  /** The epics without their documents; `assembleEpic` adds the document. */
  epics: Epic[];
  epicTaskCounts: Record<string, EpicTaskCounts>;
  problems: Problem[];
}

const refOf = (epic: SummaryEpic): EpicRef => ({
  id: epic.id,
  name: epic.name,
  color: epic.color,
});

/** A card from the Summary's task; the epic is resolved against the Summary's epics. */
export function toTaskSummary(task: SummaryTask, epics: readonly SummaryEpic[]): TaskSummary {
  const epic = task.epicId === null ? undefined : epics.find((item) => item.id === task.epicId);
  const card: TaskSummary = {
    id: task.id,
    title: task.title,
    assignee: task.assignee,
    taskStatus: task.taskStatus,
    taskStatusChangedAt: task.taskStatusChangedAt,
    position: task.position,
    agentStatus: task.agentStatus,
    agentStatusChangedAt: task.agentStatusChangedAt,
    pendingReason: task.pendingReason,
    pendingRequestId: task.pendingRequestId,
    pendingChoices: task.pendingChoices,
    epic: epic ? refOf(epic) : null,
    updatedAt: task.updatedAt,
    createdAt: task.createdAt,
    isDraft: task.isDraft,
    acceptance: { done: task.acceptance.done, total: task.acceptance.total },
    acceptanceError: task.acceptanceError,
  };
  if (task.onboardingSample) card.onboardingSample = task.onboardingSample;
  return card;
}

/** An epic as the epic screens take it, with no document yet. */
export function toEpic(epic: SummaryEpic): Epic {
  return {
    ...refOf(epic),
    isDraft: epic.isDraft,
    document: '',
    body: '',
    priority: [...epic.priority],
    priorityError: epic.priorityError,
    attachments: [],
    createdAt: '',
    updatedAt: '',
  };
}

export function toBoardView(summary: Summary): BoardView {
  const counts: Record<string, EpicTaskCounts> = {};
  for (const epic of summary.epics) counts[epic.id] = { ...epic.progress };
  return {
    project: summary.project,
    version: summary.version,
    tasks: summary.tasks.map((task) => toTaskSummary(task, summary.epics)),
    epics: summary.epics.map(toEpic),
    epicTaskCounts: counts,
    problems: summary.problems,
  };
}

/** The Markdown text of a Detail's blocks: joined, they give the file's body back. */
export function bodyOf(document: DocumentData | null): string {
  return document ? document.blocks.map((block) => block.text).join('') : '';
}

/**
 * The full `Task` an editing dialog takes, from a card and the Detail just read for it. The
 * screens that show a task read its Detail themselves; only the editors still take a whole task.
 * The body is the blocks joined; the conditions and the attachment list come from the document.
 * `description` is the body too: the server's body is the whole file only when the frontmatter has
 * no closing line, so a closed frontmatter that cannot be read starts the editor's whole-file mode
 * without it.
 */
export function taskForEditor(card: TaskSummary, document: DocumentData): Task {
  const body = bodyOf(document);
  return {
    id: card.id,
    title: card.title,
    description: body,
    body,
    acceptance: document.acceptance.map(({ id, text, done }) => ({ id, text, done })),
    acceptanceError: card.acceptanceError ?? false,
    assignee: card.assignee,
    taskStatus: card.taskStatus,
    taskStatusChangedAt: card.taskStatusChangedAt,
    position: card.position,
    agentStatus: card.agentStatus,
    pendingReason: card.pendingReason,
    pendingRequestId: card.pendingRequestId,
    ...(card.onboardingSample
      ? { onboardingSample: card.onboardingSample as NonNullable<Task['onboardingSample']> }
      : {}),
    pendingChoices: card.pendingChoices,
    epic: card.epic,
    createdAt: card.createdAt ?? card.updatedAt,
    updatedAt: card.updatedAt,
    agentStatusChangedAt: card.agentStatusChangedAt,
    isDraft: card.isDraft,
    history: [],
    attachments: document.attachments ? [...document.attachments] : [],
  };
}

/** An epic with its document, for the epic editor: the body is the blocks joined. */
export function epicForEditor(epic: Epic, document: DocumentData): Epic {
  const body = bodyOf(document);
  return {
    ...epic,
    body,
    document: body,
    attachments: document.attachments ? [...document.attachments] : epic.attachments,
  };
}
