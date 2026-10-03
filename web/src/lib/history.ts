import type { ColumnName, Transition } from '../types';

export interface HistoryItem {
  column: ColumnName;
  /** `Created` for the creation transition, otherwise only the timestamp is shown. */
  label: 'Created' | null;
  at: string;
}

/** One point per transition, oldest first. Returning to an earlier column adds a new point. */
export function historyItems(transitions: Transition[]): HistoryItem[] {
  return transitions.map((t) => ({
    column: t.to,
    label: t.from === null ? 'Created' : null,
    at: t.at,
  }));
}
