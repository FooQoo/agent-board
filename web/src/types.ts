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
  history: HistoryEvent[];
}

export interface BoardInfo {
  name: string;
  createdAt: string;
}

/** Response body of `GET /api/board`. */
export interface Board {
  board: BoardInfo;
  revision: number;
  cards: Card[];
}

/** Error body shared by the CLI `--json` output and the Web API. */
export interface ApiError {
  error: {
    code: string;
    message: string;
    reason: string;
  };
}
