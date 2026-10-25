import type { MonitorTask } from '../contracts';

/** Select each active card once by board lane, regardless of owner or agent run state. */
export function selectMonitorTasks(tasks: readonly MonitorTask[]) {
  const active = tasks.filter(({ task }) => !task.archivedAt);
  return {
    todo: active.filter(({ task }) => task.taskStatus === 'todo'),
    doing: active.filter(({ task }) => task.taskStatus === 'doing'),
    done: active.filter(({ task }) => task.taskStatus === 'done'),
  };
}
