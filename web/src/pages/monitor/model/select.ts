import type { MonitorTask } from '../contracts';

/** Select each active card once by board lane, regardless of owner or agent run state; AI drafts are left out. */
export function selectMonitorTasks(tasks: readonly MonitorTask[]) {
  // An AI draft is shown through its plan card, never as a card of its own.
  const active = tasks.filter(({ task }) => !task.archivedAt && task.draft !== 'ai');
  return {
    todo: active.filter(({ task }) => task.taskStatus === 'todo'),
    doing: active.filter(({ task }) => task.taskStatus === 'doing'),
    done: active.filter(({ task }) => task.taskStatus === 'done'),
  };
}
