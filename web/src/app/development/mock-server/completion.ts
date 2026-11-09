import type { Task } from '../../../shared/api/contracts.ts';
import type { Change } from '../../../shared/data/api/contracts.ts';
import type { MockBoard } from './boards.ts';
import { taskChangeOf } from './wire.ts';

// The automatic Done of `agboard serve`: once every acceptance condition of an AI task is met, the
// task moves to Done, the way the server's watcher completes it after each save.

/** `ja` when the text has kana or kanji, as the server infers the language of generated history. */
export function inferLanguage(task: Pick<Task, 'body' | 'title'>): 'en' | 'ja' {
  const prose = task.body.trim() ? task.body : task.title;
  return /[\u3040-\u30ff\u3400-\u9fff]/.test(prose) ? 'ja' : 'en';
}

/** Whether the task is one the server completes: AI, in Todo or Doing, with every condition met. */
export function completesAutomatically(task: Task): boolean {
  return (
    task.assignee === 'ai' &&
    !task.isDraft &&
    !task.archivedAt &&
    (task.taskStatus === 'todo' || task.taskStatus === 'doing') &&
    task.agentStatus !== 'pending' &&
    !task.acceptanceError &&
    task.acceptance.length > 0 &&
    task.acceptance.every((item) => item.done)
  );
}

const COMPLETED = {
  en: 'All acceptance conditions are complete.',
  ja: 'すべての受入条件を達成しました。',
};

/** The tasks of the board that move to Done now, and their changes; none when nothing completes. */
export function completedTasks(board: MockBoard, at: string): { tasks: Task[]; changes: Change[] } {
  const done = board.tasks.filter((task) => task.taskStatus === 'done' && !task.archivedAt);
  let position = Math.max(0, ...done.map((task) => task.position));
  const tasks = board.tasks.filter(completesAutomatically).map((task): Task => {
    position += 1;
    return {
      ...task,
      taskStatus: 'done',
      taskStatusChangedAt: at,
      position,
      agentStatus: 'idle',
      ...(task.agentStatus === 'idle' ? {} : { agentStatusChangedAt: at }),
      pendingReason: null,
      pendingRequestId: null,
      pendingChoices: [],
      updatedAt: at,
      history: [...task.history, { at, reason: COMPLETED[inferLanguage(task)] }],
    };
  });
  const before = (id: number) => board.tasks.find((task) => task.id === id);
  return {
    tasks,
    changes: tasks.map((task) => taskChangeOf(before(task.id), task, ['summary', 'history'])),
  };
}
