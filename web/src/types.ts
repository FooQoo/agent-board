export type ColumnName = 'todo' | 'doing' | 'done';
export type RunState = 'idle' | 'running' | 'pending';
export type Assignee = 'ai' | 'human';
export type Actor = 'ai' | 'human';
export type HistoryKind = 'created' | 'lane' | 'agent';

export interface HistoryEvent {
  id: number;
  kind: HistoryKind;
  actor: Actor;
  reason: string | null;
  fromCardStatus: ColumnName | null;
  toCardStatus: ColumnName;
  fromAgentStatus: RunState | null;
  toAgentStatus: RunState;
  requestId: string | null;
  at: string;
}

export interface Card {
  id: number;
  title: string;
  description: string;
  assignee: Assignee;
  cardStatus: ColumnName;
  position: number;
  agentStatus: RunState;
  pendingReason: string | null;
  pendingRequestId: string | null;
  createdAt: string;
  updatedAt: string;
  agentStatusChangedAt: string;
  /** A draft is read-only for agents until a person finalizes it. */
  isDraft: boolean;
  history: HistoryEvent[];
}

export interface BoardInfo {
  name: string;
  createdAt: string;
}

/** The immutable identifier of a project: 32 lowercase hexadecimal digits. */
export type ProjectId = string;

export interface Project {
  id: ProjectId;
  name: string;
  createdAt: string;
}

/** Response body of `GET /api/projects`. */
export interface ProjectList {
  projects: Project[];
  catalogRevision: number;
}

/** Response body of `GET /api/projects/{projectId}/board`. */
export interface Board {
  project: Project;
  board: BoardInfo;
  revision: number;
  cursor: string;
  cards: Card[];
}

/** What a card operation (create, move, answer, edit) is asked to do. */
export type DialogAction =
  | { kind: 'create' }
  | { kind: 'move'; card: Card; target: ColumnName }
  | { kind: 'answer'; card: Card }
  | { kind: 'edit'; card: Card };

/** Error body shared by the CLI `--json` output and the Web API. */
export interface ApiError {
  error: {
    code: string;
    message: string;
    reason: string;
  };
}
