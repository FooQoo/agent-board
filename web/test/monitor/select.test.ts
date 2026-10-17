import { describe, expect, it } from 'vitest';
import { PROJECT_A, PROJECT_B, makeTask } from '../fixtures';
import { selectMonitorTasks } from '../../src/monitor/model/select';
import type { MonitorTask } from '../../src/monitor/contracts';

const item = (
  projectId: string,
  id: number,
  taskStatus: 'todo' | 'doing' | 'done',
  agentStatus: 'idle' | 'running' | 'pending',
  archivedAt?: string,
): MonitorTask => ({
  projectId,
  projectName: projectId === PROJECT_A.id ? PROJECT_A.name : PROJECT_B.name,
  task: makeTask({ id, taskStatus, agentStatus, archivedAt, isDraft: true }),
});

describe('selectMonitorCards', () => {
  it('groups each draft, human and AI task once by lane, including all Doing run states', () => {
    const human = item(PROJECT_A.id, 6, 'todo', 'idle');
    human.task.assignee = 'human';
    const humanDoing = item(PROJECT_A.id, 8, 'doing', 'idle');
    humanDoing.task.assignee = 'human';
    const humanDone = item(PROJECT_A.id, 9, 'done', 'idle');
    humanDone.task.assignee = 'human';
    const result = selectMonitorTasks(
      [
        item(PROJECT_A.id, 1, 'todo', 'idle'),
        item(PROJECT_A.id, 2, 'doing', 'running'),
        item(PROJECT_A.id, 3, 'done', 'running'),
        item(PROJECT_A.id, 4, 'doing', 'idle'),
        item(PROJECT_A.id, 5, 'doing', 'pending'),
        human,
        humanDoing,
        humanDone,
        item(PROJECT_A.id, 7, 'todo', 'idle', '2026-10-01T00:00:00Z'),
      ],
      'all',
    );
    expect(result.todo.map(({ task }) => task.id)).toEqual([1, 6]);
    expect(result.doing.map(({ task }) => task.id)).toEqual([2, 4, 5, 8]);
    expect(result.done.map(({ task }) => task.id)).toEqual([3, 9]);
  });

  it('limits the selected project without changing its grouping rules', () => {
    const result = selectMonitorTasks(
      [item(PROJECT_A.id, 1, 'done', 'idle'), item(PROJECT_B.id, 2, 'todo', 'idle')],
      PROJECT_B.id,
    );
    expect(result.todo.map(({ task }) => task.id)).toEqual([2]);
    expect(result.done).toEqual([]);
  });
});
