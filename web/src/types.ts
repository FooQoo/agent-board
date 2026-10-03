export type ColumnName = 'todo' | 'doing' | 'done';
export type RunState = 'idle' | 'running' | 'pending';

export interface Transition {
  from: ColumnName | null;
  to: ColumnName;
  at: string;
}

export interface Card {
  id: number;
  title: string;
  description: string;
  column: ColumnName;
  position: number;
  run_state: RunState;
  pending_reason: string | null;
  created_at: string;
  updated_at: string;
  run_state_changed_at: string;
  transitions: Transition[];
}

export interface BoardInfo {
  name: string;
  created_at: string;
}

/** Response body of `GET /api/board`. */
export interface Board {
  board: BoardInfo;
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
