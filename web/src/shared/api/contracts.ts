export type ColumnName = 'todo' | 'doing' | 'done';
export type RunState = 'idle' | 'running' | 'pending';
export type Assignee = 'ai' | 'human';
export type Actor = 'ai' | 'human';

/** One option of a decision request. */
export interface Choice {
  id: string;
  label: string;
}

export interface HistoryEvent {
  at: string;
  reason: string;
}

export interface Attachment {
  id: string;
  name: string;
  mediaType: string;
  size: number;
  createdAt: string;
}

/** A text file kept as evidence of a card. */
export interface EvidenceRecord {
  id: string;
  name: string;
  size: number;
  createdAt: string;
}

/** The epic a card belongs to, as the board shows it. */
export interface EpicRef {
  id: string;
  name: string;
  /** `#RRGGBB`. */
  color: string;
}

export interface Epic extends EpicRef {
  isDraft: boolean;
  /** The whole EPIC.md text, frontmatter included. */
  document: string;
  /** EPIC.md without its frontmatter. The whole file when the frontmatter has a defect. */
  body: string;
  /** The card order of the epic (EPIC.md `priority`); empty when none is stored. */
  priority: number[];
  /** The stored order cannot be read; it is then ignored. */
  priorityError: boolean;
  attachments: Attachment[];
  createdAt: string;
  updatedAt: string;
}

/** The immutable identifier of a project: 32 lowercase hexadecimal digits. */
export type ProjectId = string;

export interface Project {
  id: ProjectId;
  name: string;
  createdAt: string;
}

/** A format defect in a shared file. `file` is relative to the shared folder. */
export interface Problem {
  file: string;
  field: string;
  reason: string;
}

/** One completion condition, read from the frontmatter of a TASK.md. */
export interface AcceptanceItem {
  id: string;
  text: string;
  done: boolean;
}

export interface Task {
  id: number;
  title: string;
  /** The whole TASK.md text, frontmatter included. */
  description: string;
  /** TASK.md without its frontmatter. The whole file when the frontmatter has a defect. */
  body: string;
  acceptance: AcceptanceItem[];
  acceptanceError: boolean;
  assignee: Assignee;
  taskStatus: ColumnName;
  /** Time of the last real lane change; independent of later notes and edits. */
  taskStatusChangedAt: string;
  position: number;
  agentStatus: RunState;
  pendingReason: string | null;
  pendingRequestId: string | null;
  pendingChoices: Choice[];
  epic: EpicRef | null;
  createdAt: string;
  updatedAt: string;
  agentStatusChangedAt: string;
  /** A draft is read-only for agents until a person finalizes it. */
  isDraft: boolean;
  archivedAt?: string | null;
  /** TASK.md frontmatter history, read from the canonical Markdown file. */
  history: HistoryEvent[];
  attachments: Attachment[];
  evidence: EvidenceRecord[];
}

/** Response body of `GET /api/projects`. */
export interface ProjectList {
  projects: Project[];
  catalogVersion: string;
}

/** A board snapshot: `GET /api/projects/{projectId}/board`. */
/** How many of an epic's tasks are in each group. `total` is the sum of the four. */
export interface EpicTaskCounts {
  todo: number;
  doing: number;
  done: number;
  archived: number;
  total: number;
}

export interface Board {
  project: Project;
  version: string;
  cursor: string;
  epics: Epic[];
  /** The counts of every epic, keyed by epic ID, from the same snapshot as `epics`. */
  epicTaskCounts: Record<string, EpicTaskCounts>;
  tasks: Task[];
  problems: Problem[];
}

/** What a card dialog (create, move, edit) is asked to do. */
export type DialogAction =
  | { kind: 'create' }
  | { kind: 'request' }
  | { kind: 'move'; task: Task; target: ColumnName }
  | { kind: 'edit'; task: Task }
  | { kind: 'epic'; epic: Epic };

/** Error body shared by the CLI `--json` output and the Web API. */
export interface ApiError {
  error: {
    code: string;
    message: string;
    reason: string;
  };
}
