// The wire contract of the data layer, mirrored from `src/server/contracts/` in the Rust server.
// The shapes are checked against the golden examples in `tests/fixtures/data-layer/`.
// This file has types only; parsing is in `parse.ts` and the Detail order checks in
// `detail-stream.ts`.
import type {
  Assignee,
  Attachment,
  Choice,
  ColumnName,
  ProjectId,
  RunState,
} from '../../api/contracts';

/** An opaque content hash. Compare for equality; never read it. */
export type Version = string;

export type DetailSection = 'document' | 'history';

// ---- Summary: `GET .../projects/{projectId}/summary`

export interface SummaryProject {
  id: ProjectId;
  name: string;
}

export interface AcceptanceCount {
  done: number;
  total: number;
}

export interface TaskDetailVersions {
  document: Version;
  history: Version;
}

/** A task without its body, acceptance text and history. */
export interface SummaryTask {
  id: number;
  title: string;
  taskStatus: ColumnName;
  agentStatus: RunState;
  assignee: Assignee;
  isDraft: boolean;
  position: number;
  epicId: string | null;
  acceptance: AcceptanceCount;
  /** The conditions cannot be read from the frontmatter; the full text is then the body. */
  acceptanceError: boolean;
  /** When the task was created. */
  createdAt: string;
  updatedAt: string;
  pendingRequestId: string | null;
  pendingReason: string | null;
  pendingChoices: Choice[];
  taskStatusChangedAt: string;
  agentStatusChangedAt: string;
  onboardingSample?: { runId: string; ordinal: number };
  detailVersions: TaskDetailVersions;
}

export interface SummaryEpicProgress {
  todo: number;
  doing: number;
  done: number;
  archived: number;
  total: number;
}

export interface SummaryEpic {
  id: string;
  name: string;
  /** `#RRGGBB`. */
  color: string;
  isDraft: boolean;
  /** The IDs of the epic's tasks in the order the epic sets; empty when it sets none. */
  priority: number[];
  /** The stored order cannot be read, so it is ignored. */
  priorityError: boolean;
  progress: SummaryEpicProgress;
  detailVersions: { document: Version };
}

export interface SummaryProblem {
  file: string;
  field: string;
  reason: string;
}

export interface Summary {
  project: SummaryProject;
  version: Version;
  tasks: SummaryTask[];
  epics: SummaryEpic[];
  problems: SummaryProblem[];
}

// ---- Detail NDJSON: `.../tasks/{id}/detail`, `.../epics/{epicId}/detail`

export type DetailResource = 'task' | 'epic';
export type BlockKind = 'markdown' | 'mermaid';

/** The versions of the sections in one stream; `start` and `complete` carry the same value. */
export interface DetailVersions {
  document?: Version;
  history?: Version;
}

export interface DetailImage {
  /** The same string as the URL in the block's text. */
  src: string;
  /** Absent when the file header cannot be read. */
  width?: number;
  height?: number;
}

/** One attachment of a task or an epic, as its record in `task.json` / `epic.json` has it. */
export type DetailAttachment = Attachment;

export type DetailEvent =
  | {
      type: 'start';
      resource: DetailResource;
      id: number | string;
      projectId: ProjectId;
      sections: DetailSection[];
      versions: DetailVersions;
    }
  | { type: 'section-start'; section: DetailSection }
  /** The attachments of the resource: once per `document` section, before the first block. */
  | { type: 'attachments'; items: DetailAttachment[] }
  | { type: 'block'; kind: BlockKind; text: string; images?: DetailImage[] }
  | { type: 'acceptance'; id: string; text: string; done: boolean }
  | { type: 'history-item'; at: string; reason: string }
  | { type: 'section-end'; section: DetailSection; count: number }
  | { type: 'complete'; versions: DetailVersions };

// ---- SSE `changed`

export type ChangeResource = 'task' | 'epic' | 'project';
export type Facet = 'summary' | 'document' | 'history' | 'deleted';

export interface Change {
  resource: ChangeResource;
  /** An integer for a task, a string for an epic and a project. */
  id: number | string;
  facets: Facet[];
}

export interface ChangedEvent {
  /** Identifies one server start; a new value means `seq` began again. */
  instanceId: string;
  /** Grows by one per `changed` within an instance; a gap means a missed event. */
  seq: number;
  projectId: ProjectId;
  changes: Change[];
}
