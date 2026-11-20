import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectId } from '../src/shared/api/contracts';
import { TaskStatusChangedError, moveTask } from '../src/features/tasks/api/lifecycle';

const project = 'a'.repeat(32) as ProjectId;

afterEach(() => vi.unstubAllGlobals());

describe('moveTask', () => {
  it('sends the target and the status the page showed, and no reason', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ task: {}, changed: true })));
    vi.stubGlobal('fetch', fetchMock);
    await moveTask(project, 7, 'doing', 'todo');
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(JSON.parse(String(init.body))).toEqual({ taskStatus: 'doing', fromStatus: 'todo' });
  });

  it('names the current status when the task moved meanwhile', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: { code: 'task_status_changed', message: 'changed.', reason: 'moved.' },
              currentStatus: 'done',
            }),
            { status: 409 },
          ),
      ),
    );
    const failure = await moveTask(project, 7, 'doing', 'todo').catch((cause: unknown) => cause);
    expect(failure).toBeInstanceOf(TaskStatusChangedError);
    expect((failure as TaskStatusChangedError).current).toBe('done');
  });
});
