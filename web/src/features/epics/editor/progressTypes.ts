import type { ReactNode } from 'react';
import type { TaskSummary } from '../../../shared/api/contracts';

/** What a card gives the caller to draw a task: the drag grip to place, and the card's actions. */
export interface ProgressTaskRow {
  /** The grip a person drags the card by; the caller puts it where it fits. */
  grip: ReactNode;
  disabled: boolean;
  onOpen: () => void;
}

export type ProgressTaskRenderer = (task: TaskSummary, row: ProgressTaskRow) => ReactNode;
