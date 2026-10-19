import type { Task, ColumnName } from '../../../shared/api/contracts';
import type { TFunction } from 'i18next';
import { pad } from '../../../shared/lib/time/formatTime';

/** Local time as `MM/DD HH:mm` from an RFC 3339 timestamp. */
export function formatShort(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function taskCountLabel(n: number, t?: TFunction): string {
  return t ? t('status.cardCount', { count: n }) : n === 1 ? '1 task' : `${n} tasks`;
}

const COLUMN_LABELS: Record<ColumnName, string> = {
  todo: 'Todo',
  doing: 'Doing',
  done: 'Done',
};

export function columnLabel(c: ColumnName, t?: TFunction): string {
  return t ? t(`column.${c}`) : COLUMN_LABELS[c];
}

const STATE_LABELS = {
  idle: 'Idle',
  running: 'Running',
  pending: 'Pending',
} as const;

/** The run state is only shown for cards in Doing. */
export function stateLabel(task: Task, t?: TFunction): string | null {
  // An AI card shows its run state in Doing, and a pending question in Todo (before the work starts).
  const shows =
    task.assignee === 'ai' &&
    (task.taskStatus === 'doing' || (task.taskStatus === 'todo' && task.agentStatus === 'pending'));
  if (!shows) return null;
  return t ? t(`runState.${task.agentStatus}`) : STATE_LABELS[task.agentStatus];
}
