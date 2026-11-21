import { describe, expect, it } from 'vitest';
import { makeMonitorTask, makeProject, makeTask } from '../../../../.storybook/support/fixtures';
import { selectMonitorTasks } from './select';

const project = makeProject();
const item = (
  id: number,
  extra: Parameters<typeof makeTask>[0] extends infer T ? Partial<T> : never,
) => makeMonitorTask(makeTask({ id, ...extra }), project);

describe('selectMonitorTasks', () => {
  it("keeps a person's drafts and the Backlog in their lanes", () => {
    const lanes = selectMonitorTasks([
      item(1, { taskStatus: 'todo' }),
      item(2, { taskStatus: 'todo', draft: 'human' }),
      item(3, { taskStatus: 'backlog' }),
      item(4, { taskStatus: 'doing' }),
    ]);
    expect(lanes.todo.map((entry) => entry.task.id)).toEqual([1, 2]);
    expect(lanes.backlog.map((entry) => entry.task.id)).toEqual([3]);
    expect(lanes.doing.map((entry) => entry.task.id)).toEqual([4]);
  });
});
