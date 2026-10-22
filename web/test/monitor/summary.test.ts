import { describe, expect, it } from 'vitest';
import { monitorTasksOf } from '../../src/pages/monitor/model/summary';
import { summaryOf } from '../../src/shared/data/core/test-support';

const PROJECT = 'a'.repeat(32);

describe('monitorTasksOf', () => {
  it('turns each Summary task into a card of the project, without any body or history', () => {
    const summary = summaryOf([{ id: 3, document: 'd', history: 'h' }], 'sv', PROJECT, [
      { id: 'EP-1', document: 'e' },
    ]);
    const [task] = summary.tasks;
    if (!task) throw new Error('fixture');
    Object.assign(task, {
      title: 'Third',
      taskStatus: 'doing',
      agentStatus: 'pending',
      pendingRequestId: 'r1',
      pendingReason: 'Which one?',
      pendingChoices: [{ id: 'a', label: 'A' }],
      epicId: 'EP-1',
      acceptance: { done: 1, total: 3 },
      taskStatusChangedAt: '2026-02-01T00:00:00Z',
    });
    const [item] = monitorTasksOf(summary);
    expect(item).toMatchObject({ projectId: PROJECT, projectName: PROJECT });
    expect(item?.task).toMatchObject({
      id: 3,
      title: 'Third',
      taskStatus: 'doing',
      agentStatus: 'pending',
      pendingRequestId: 'r1',
      pendingReason: 'Which one?',
      pendingChoices: [{ id: 'a', label: 'A' }],
      epic: { id: 'EP-1', name: 'EP-1', color: '#112233' },
      body: '',
      history: [],
      attachments: [],
      acceptanceError: false,
    });
  });

  it('carries the acceptance count so the card shows its progress', () => {
    const summary = summaryOf([{ id: 1, document: 'd', history: 'h' }], 'sv', PROJECT);
    const [task] = summary.tasks;
    if (!task) throw new Error('fixture');
    task.acceptance = { done: 2, total: 5 };
    const [item] = monitorTasksOf(summary);
    expect(item?.task.acceptance).toHaveLength(5);
    expect(item?.task.acceptance.filter((entry) => entry.done)).toHaveLength(2);
  });

  it('keeps an epic the Summary does not list as a plain reference rather than dropping it', () => {
    const summary = summaryOf([{ id: 1, document: 'd', history: 'h' }], 'sv', PROJECT);
    const [task] = summary.tasks;
    if (!task) throw new Error('fixture');
    task.epicId = 'GONE-1';
    const [item] = monitorTasksOf(summary);
    expect(item?.task.epic).toMatchObject({ id: 'GONE-1', name: 'GONE-1' });
  });

  it('uses the lane change time for a card that has no creation time', () => {
    const summary = summaryOf([{ id: 1, document: 'd', history: 'h' }], 'sv', PROJECT);
    const [task] = summary.tasks;
    if (!task) throw new Error('fixture');
    task.taskStatusChangedAt = '2026-03-04T05:06:07Z';
    const [item] = monitorTasksOf(summary);
    expect(item?.task.createdAt).toBe('2026-03-04T05:06:07Z');
    expect(item?.task.taskStatusChangedAt).toBe('2026-03-04T05:06:07Z');
  });
});
