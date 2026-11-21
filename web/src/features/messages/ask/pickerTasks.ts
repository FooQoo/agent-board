import type { ColumnName } from '../../../shared/api/contracts';

/** What the picker needs of a task. A `TaskSummary` fits. */
export interface PickerTask {
  id: number;
  title: string;
  taskStatus: ColumnName;
  taskStatusChangedAt?: string;
}

const LANE_ORDER: Record<ColumnName, number> = {
  doing: 0,
  todo: 1,
  backlog: 2,
  done: 3,
};

/** Active work first, then what is waiting (Todo, then the Backlog), then what is done; the most recently moved first. */
export function orderPickerTasks(tasks: readonly PickerTask[]): PickerTask[] {
  return [...tasks].sort(
    (a, b) =>
      LANE_ORDER[a.taskStatus] - LANE_ORDER[b.taskStatus] ||
      (b.taskStatusChangedAt ?? '').localeCompare(a.taskStatusChangedAt ?? '') ||
      b.id - a.id,
  );
}

/** Whether a task matches what was typed: the start of its number (with or without `#`), or a word of its title. */
export function matchesPickerQuery(task: PickerTask, query: string): boolean {
  const q = query.trim().replace(/^#/, '').toLowerCase();
  if (q === '') return true;
  return String(task.id).startsWith(q) || task.title.toLowerCase().includes(q);
}
