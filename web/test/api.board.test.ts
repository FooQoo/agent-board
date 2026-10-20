import { describe, expect, it } from 'vitest';
import { problemOf, toBoard, WriteError } from '../src/app/api';

type WireTask = Parameters<typeof toBoard>[0]['tasks'][number];

const wireTask = (overrides: Record<string, unknown> = {}) =>
  ({
    id: 3,
    title: 'Task',
    description: '',
    assignee: 'ai',
    epicId: null,
    taskStatus: 'doing',
    position: 1,
    agentStatus: 'pending',
    isDraft: false,
    pendingRequestId: 'req-1',
    pendingReason: 'Which one?',
    pendingChoices: [{ id: 'a', label: 'Option A' }],
    archivedAt: null,
    attachments: [],
    createdAt: '2026-10-02T00:00:00Z',
    updatedAt: '2026-10-02T00:00:00Z',
    agentStatusChangedAt: '2026-10-02T00:00:00Z',
    history: [],
    ...overrides,
  }) as unknown as WireTask;

describe('toBoard', () => {
  it('keeps the version, cursor, epics and problems of the snapshot', () => {
    const board = toBoard({
      project: { id: 'a'.repeat(32), name: 'p', createdAt: '2026-10-01T00:00:00Z' },
      version: 'f1-version',
      cursor: 'f1:x:y',
      epicTaskCounts: {},
      epics: [
        {
          id: 'FILE-SHARE',
          name: 'File share',
          color: '#7C3AED',
          isDraft: false,
          document: '',
          body: '',
          priority: [],
          priorityError: false,
          attachments: [],
          createdAt: '2026-10-01T00:00:00Z',
          updatedAt: '2026-10-01T00:00:00Z',
        },
      ],
      tasks: [wireTask({ epicId: 'FILE-SHARE' })],
      problems: [{ file: 'tasks/3/TASK.md', field: 'AC-1', reason: 'missing' }],
    });
    expect(board.version).toBe('f1-version');
    expect(board.cursor).toBe('f1:x:y');
    expect(board.epics).toHaveLength(1);
    expect(board.problems).toEqual([{ file: 'tasks/3/TASK.md', field: 'AC-1', reason: 'missing' }]);
  });

  it('joins a task with its epic and leaves an unlabeled task with null', () => {
    const board = toBoard({
      project: { id: 'a'.repeat(32), name: 'p', createdAt: '2026-10-01T00:00:00Z' },
      version: 'v',
      cursor: 'c',
      epicTaskCounts: {},
      epics: [
        {
          id: 'FILE-SHARE',
          name: 'File share',
          color: '#7C3AED',
          isDraft: false,
          document: '',
          body: '',
          priority: [],
          priorityError: false,
          attachments: [],
          createdAt: '2026-10-01T00:00:00Z',
          updatedAt: '2026-10-01T00:00:00Z',
        },
      ],
      tasks: [wireTask({ epicId: 'FILE-SHARE' }), wireTask({ id: 4, epicId: null })],
      problems: [],
    });
    expect(board.tasks[0]?.epic).toEqual({
      id: 'FILE-SHARE',
      name: 'File share',
      color: '#7C3AED',
    });
    expect(board.tasks[1]?.epic).toBeNull();
    expect(board.tasks[0]).not.toHaveProperty('epicId');
    expect(board.tasks[0]?.pendingChoices).toEqual([{ id: 'a', label: 'Option A' }]);
  });
});

describe('problemOf', () => {
  it('reads the file, field and reason of a file_invalid answer', () => {
    const error = new WriteError('ID: wrong', 422, 'file_invalid', 'tasks/3/TASK.md is not valid.');
    expect(problemOf(error)).toEqual({ file: 'tasks/3/TASK.md', field: 'ID', reason: 'wrong' });
  });

  it('is null for other errors', () => {
    expect(problemOf(new WriteError('x', 409, 'request_changed'))).toBeNull();
    expect(problemOf(new Error('network'))).toBeNull();
  });
});
