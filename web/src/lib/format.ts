import type { Card, ColumnName } from '../types';

const pad = (n: number): string => String(n).padStart(2, '0');

/** Local time as `MM/DD HH:mm` from an RFC 3339 timestamp. */
export function formatShort(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Local time as `HH:mm`. */
export function formatTime(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function cardCountLabel(n: number): string {
  return n === 1 ? '1 card' : `${n} cards`;
}

const COLUMN_LABELS: Record<ColumnName, string> = {
  todo: 'Todo',
  doing: 'Doing',
  done: 'Done',
};

export function columnLabel(c: ColumnName): string {
  return COLUMN_LABELS[c];
}

const STATE_LABELS = {
  idle: 'Idle',
  running: 'Running',
  pending: 'Pending',
} as const;

/** The run state is only shown for cards in Doing. */
export function stateLabel(card: Card): 'Idle' | 'Running' | 'Pending' | null {
  return card.column === 'doing' ? STATE_LABELS[card.run_state] : null;
}
