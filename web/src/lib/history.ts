import type { ColumnName, Transition } from '../types';

export interface HistoryItem {
  column: ColumnName;
  /** True only for the creation transition. The view chooses its localized label. */
  created: boolean;
  at: string;
}

/** One point per transition, oldest first. Returning to an earlier column adds a new point. */
export function historyItems(transitions: Transition[]): HistoryItem[] {
  return transitions.map((t) => ({
    column: t.to,
    created: t.from === null,
    at: t.at,
  }));
}
