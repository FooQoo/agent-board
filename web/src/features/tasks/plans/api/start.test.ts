import { afterEach, describe, expect, it, vi } from 'vitest';
import { WriteError } from '../../../../shared/api/writeErrors';
import type { Plan } from '../model/plan';
import { blockingQuestionIds, startPlan } from './start';

const plan = (extra: Partial<Plan>): Plan => ({
  id: 'LOGIN-1',
  kind: 'new',
  epicId: 'LOGIN-1',
  epicName: 'Login',
  tasks: [{ id: 21, title: 'Build', assignee: 'ai', acceptance: 1 }],
  questions: [],
  ...extra,
});

afterEach(() => vi.unstubAllGlobals());

function stubFetch(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('startPlan', () => {
  it('starts the epic of an epic plan', async () => {
    const fetchMock = stubFetch(200, { epic: {}, started: [21], changed: true });
    await startPlan('p1', plan({}));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/projects/p1/epics/LOGIN-1/start',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('starts the one task of a single-task plan', async () => {
    const fetchMock = stubFetch(200, { task: {} });
    await startPlan(
      'p1',
      plan({
        id: '#31',
        kind: 'single',
        epicId: null,
        tasks: [{ id: 31, title: 'T', assignee: 'ai', acceptance: 0 }],
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/projects/p1/tasks/31/start',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('fails with the refusal for an unanswered question', async () => {
    stubFetch(409, {
      error: {
        code: 'start_blocked_by_questions',
        message: 'Q-14 and Q-15 have no reply.',
        reason: 'Q-14 and Q-15 have no reply.',
      },
    });
    const failure = await startPlan('p1', plan({})).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(WriteError);
    expect(blockingQuestionIds(failure)).toEqual(['Q-14', 'Q-15']);
  });
});

describe('blockingQuestionIds', () => {
  it('is null for any other failure', () => {
    expect(blockingQuestionIds(new WriteError('x', 500, 'internal'))).toBeNull();
    expect(blockingQuestionIds(new Error('Q-1'))).toBeNull();
  });
});
