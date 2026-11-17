import { describe, expect, it } from 'vitest';
import type { Message, Summary, SummaryEpic, SummaryTask } from '../../../../shared/data/api';
import { isAiDraft, planOfApproval, plansOfSummary, planTitle } from './plan';

const task = (id: number, extra: Partial<SummaryTask> = {}): SummaryTask =>
  ({
    id,
    title: `Task ${id}`,
    assignee: 'ai',
    draft: 'ai',
    acceptance: { done: 0, total: 2 },
    ...extra,
  }) as SummaryTask;

const epic = (id: string, draft: SummaryEpic['draft']): SummaryEpic =>
  ({ id, name: `Epic ${id}`, draft }) as SummaryEpic;

const message = (extra: Partial<Message> & Pick<Message, 'id' | 'type'>): Message => ({
  from: 'ai',
  to: 'human',
  turn: 'human',
  title: extra.id,
  createdAt: '2026-11-17T09:00:00.000Z',
  tasks: [],
  epicId: null,
  ...extra,
});

const summary = (messages: Message[]): Pick<Summary, 'tasks' | 'epics' | 'messages'> => ({
  tasks: [task(21), task(22), task(23), task(31)],
  epics: [epic('LOGIN-1', 'ai'), epic('SEARCH-2', null)],
  messages,
});

describe('plansOfSummary', () => {
  it('makes one plan for each approval: a new epic, added tasks, and a single task', () => {
    const plans = plansOfSummary(
      summary([
        message({ id: 'LOGIN-1', type: 'approval', tasks: [21, 22], epicId: 'LOGIN-1' }),
        message({ id: 'SEARCH-2', type: 'approval', tasks: [23], epicId: 'SEARCH-2' }),
        message({ id: '#31', type: 'approval', tasks: [31] }),
      ]),
    );
    expect(plans.map((plan) => [plan.id, plan.kind])).toEqual([
      ['LOGIN-1', 'new'],
      ['SEARCH-2', 'added'],
      ['#31', 'single'],
    ]);
    expect(plans[0]?.tasks).toEqual([
      { id: 21, title: 'Task 21', assignee: 'ai', acceptance: 2 },
      { id: 22, title: 'Task 22', assignee: 'ai', acceptance: 2 },
    ]);
    expect(planTitle(plans[0] as never)).toBe('LOGIN-1 Epic LOGIN-1');
    expect(planTitle(plans[2] as never)).toBe('Task 31');
  });

  it('keeps the order of the tasks the server lists', () => {
    const [plan] = plansOfSummary(
      summary([message({ id: 'LOGIN-1', type: 'approval', tasks: [22, 21], epicId: 'LOGIN-1' })]),
    );
    expect(plan?.tasks.map((item) => item.id)).toEqual([22, 21]);
  });

  it('lists the open questions that name the epic or one of the tasks, and no others', () => {
    const [plan] = plansOfSummary(
      summary([
        message({ id: 'LOGIN-1', type: 'approval', tasks: [21, 22], epicId: 'LOGIN-1' }),
        message({ id: 'Q-1', type: 'question', tasks: [22] }),
        message({ id: 'Q-2', type: 'question', tasks: [], epicId: 'LOGIN-1' }),
        message({ id: 'Q-3', type: 'question', tasks: [23] }),
        message({ id: 'Q-4', type: 'question', tasks: [21], turn: null }),
        message({ id: 'Q-5', type: 'request', tasks: [21] }),
      ]),
    );
    expect(plan?.questions.map((question) => question.id)).toEqual(['Q-1', 'Q-2']);
  });

  it('ignores approvals that are not waiting for a person', () => {
    expect(
      plansOfSummary(summary([message({ id: '#31', type: 'approval', tasks: [31], turn: null })])),
    ).toEqual([]);
  });

  it('finds a plan by its message or its ID', () => {
    const plans = plansOfSummary(summary([message({ id: '#31', type: 'approval', tasks: [31] })]));
    expect(planOfApproval(plans, '#31')?.id).toBe('#31');
    expect(planOfApproval(plans, { id: '#31' })?.id).toBe('#31');
    expect(planOfApproval(plans, 'LOGIN-1')).toBeNull();
  });
});

describe('isAiDraft', () => {
  it('is true only for an AI draft, so a person draft keeps its card', () => {
    expect(isAiDraft({ draft: 'ai' })).toBe(true);
    expect(isAiDraft({ draft: 'human' })).toBe(false);
    expect(isAiDraft({ draft: null })).toBe(false);
  });
});
