import type {
  AcceptanceItem,
  Epic,
  EpicRef,
  EpicTaskCounts,
  Problem,
  Task,
  TaskSummary,
} from '../../shared/api/contracts';
import type { Summary, SummaryEpic, SummaryProject, SummaryTask } from '../../shared/data/api';
import type { DocumentData, HistoryData } from '../../shared/data/core';

/**
 * The bridge between the data layer and the screens that still take the old shapes. The list
 * shows `TaskSummary` cards; the detail drawer and the editors get a full `Task` assembled from a
 * card and the cached Detail. The bridge goes away when those screens read Detail directly.
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

/** The sections of a Detail that the drawer shows. An absent section reads as empty. */
export interface DetailParts {
  document: DocumentData | null;
  history: HistoryData | null;
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
 * A full `Task` from a card and its Detail. The body is the blocks joined; the conditions and the
 * history and the attachment list come from the Detail. The creation time and the condition read
 * error come from the card (the Summary). `description` is the body. The server's body is the
 * whole file only when the frontmatter has no closing line; a closed frontmatter that cannot be
 * read is cut off, so the editor's whole-file mode then starts without it.
 */
export function assembleTask(card: TaskSummary, detail: DetailParts): Task {
  const acceptance: AcceptanceItem[] = detail.document
    ? detail.document.acceptance.map(({ id, text, done }) => ({ id, text, done }))
    : [];
  const body = bodyOf(detail.document);
  return {
    id: card.id,
    title: card.title,
    description: body,
    body,
    acceptance,
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
    history: detail.history ? detail.history.items.map(({ at, reason }) => ({ at, reason })) : [],
    attachments: detail.document?.attachments ? [...detail.document.attachments] : [],
  };
}

/** An epic with its document: the body is the blocks joined; the attachments come with it. */
export function assembleEpic(epic: Epic, document: DocumentData | null): Epic {
  const body = bodyOf(document);
  return {
    ...epic,
    body,
    document: body,
    attachments: document?.attachments ? [...document.attachments] : epic.attachments,
  };
}
