import type { Choice, TaskSummary } from '../../shared/api/contracts';
import { ATTACHMENT_ID, fixtureText } from './fixture-text';

/** The shared shape of every exchange (SPEC 18_EXCHANGES, section 2). */
export interface Exchange {
  id: string;
  type: 'question' | 'request' | 'approval';
  from: 'ai' | 'human';
  to: 'ai' | 'human';
  /** `null` is a finished exchange. */
  turn: 'ai' | 'human' | null;
  title: string;
  createdAt: string;
  tasks: number[];
  epicId: string | null;
}

/** What only the mock needs beside the shared shape: the text to show when a row is opened. */
export interface MockExchange extends Exchange {
  body?: string;
  choices?: Choice[];
  recommended?: string;
}

export interface PlanTask {
  id: number;
  title: string;
  assignee: 'ai' | 'human';
  acceptance: number;
}

/** An approval of an epic: its AI-draft tasks, shown as one plan. */
export interface Plan {
  epicId: string;
  epicName: string;
  /** `new`: the epic itself is a draft. `added`: tasks were added to a running epic. `single`: one draft task without an epic. */
  kind: 'new' | 'added' | 'single';
  goal: string;
  tasks: PlanTask[];
  /** Open questions that name the epic or one of its draft tasks. */
  questionIds: string[];
}

/** An approval of one AI-draft task that belongs to no draft epic. */
export interface DraftTask {
  id: number;
  title: string;
  assignee: 'ai' | 'human';
  questionIds: string[];
}

/** `newEpicReady` is the new-epic plan after its question was answered. */
export type Scenario = 'newEpic' | 'newEpicReady' | 'added' | 'singleDraft' | 'all';

export interface Fixture {
  exchanges: MockExchange[];
  plans: Plan[];
  drafts: DraftTask[];
  /** The ordinary cards of the lanes (AI drafts are not here). */
  lanes: Record<'todo' | 'doing' | 'done', TaskSummary[]>;
}

export function resolveAttachment(id: string): string | null {
  return id === ATTACHMENT_ID ? '/sample-question.png' : null;
}

const NOW = '2026-11-17T09:00:00.000Z';

function card(
  id: number,
  title: string,
  taskStatus: TaskSummary['taskStatus'],
  extra: Partial<TaskSummary> = {},
): TaskSummary {
  return {
    id,
    title,
    assignee: 'ai',
    taskStatus,
    taskStatusChangedAt: NOW,
    position: id,
    agentStatus: 'idle',
    agentStatusChangedAt: NOW,
    pendingReason: null,
    pendingRequestId: null,
    pendingChoices: [],
    epic: null,
    updatedAt: NOW,
    isDraft: false,
    acceptance: { done: 0, total: 2 },
    ...extra,
  };
}

/** The synthetic data of one scenario, in the language of the Story. */
export function buildFixture(ja: boolean, scenario: Scenario): Fixture {
  const s = fixtureText(ja);
  const withNew = scenario === 'newEpic' || scenario === 'newEpicReady' || scenario === 'all';
  const answered = scenario === 'newEpicReady';
  const withAdded = scenario === 'added' || scenario === 'all';
  const withDrafts = scenario === 'singleDraft' || scenario === 'all';

  const q12: MockExchange = {
    id: 'Q-12',
    type: 'question',
    from: 'ai',
    to: 'human',
    turn: 'human',
    title: s.q12,
    createdAt: '2026-11-17T08:40:00.000Z',
    tasks: [21, 22],
    epicId: 'LOGIN-1',
    body: s.q12Body,
    choices: [
      { id: 'keep', label: s.keep },
      { id: 'drop', label: s.drop },
    ],
    recommended: 'keep',
  };
  const q13: MockExchange = {
    id: 'Q-13',
    type: 'question',
    from: 'ai',
    to: 'human',
    turn: 'human',
    title: s.q13,
    createdAt: '2026-11-17T08:20:00.000Z',
    tasks: [14],
    epicId: null,
    body: s.q13Body,
    choices: [
      { id: 'mail', label: s.q13a },
      { id: 'sso', label: s.q13b },
    ],
  };
  const r14: MockExchange = {
    id: 'Q-14',
    type: 'request',
    from: 'human',
    to: 'ai',
    turn: 'ai',
    title: s.r14,
    createdAt: '2026-11-17T08:55:00.000Z',
    tasks: [],
    epicId: null,
    body: s.r14Body,
  };
  const r11: MockExchange = {
    id: 'Q-11',
    type: 'request',
    from: 'human',
    to: 'ai',
    turn: null,
    title: s.r11,
    createdAt: '2026-11-16T15:00:00.000Z',
    tasks: [],
    epicId: null,
    body: s.r11Body,
  };
  const q9: MockExchange = {
    id: 'Q-9',
    type: 'question',
    from: 'ai',
    to: 'human',
    turn: null,
    title: s.q9,
    createdAt: '2026-11-15T11:00:00.000Z',
    tasks: [],
    epicId: null,
  };

  const plans: Plan[] = [];
  if (withNew) {
    plans.push({
      epicId: 'LOGIN-1',
      epicName: s.epicName,
      kind: 'new',
      goal: `${s.goal}\n\n${s.goalMore}`,
      tasks: [
        { id: 21, title: s.t21, assignee: 'ai', acceptance: 3 },
        { id: 22, title: s.t22, assignee: 'ai', acceptance: 2 },
        { id: 23, title: s.t23, assignee: 'ai', acceptance: 2 },
        { id: 24, title: s.t24, assignee: 'human', acceptance: 1 },
        { id: 25, title: s.t25, assignee: 'ai', acceptance: 2 },
      ],
      questionIds: answered ? [] : ['Q-12'],
    });
  }
  if (withAdded) {
    plans.push({
      epicId: withNew ? 'SEARCH-2' : 'LOGIN-1',
      epicName: withNew ? (ja ? '検索の改善' : 'Improve search') : s.epicName,
      kind: 'added',
      goal: s.goal,
      tasks: [
        { id: 26, title: s.addedA, assignee: 'ai', acceptance: 2 },
        { id: 27, title: s.addedB, assignee: 'human', acceptance: 1 },
      ],
      questionIds: [],
    });
  }
  const drafts: DraftTask[] = withDrafts
    ? [
        { id: 31, title: s.d31, assignee: 'ai', questionIds: [] },
        { id: 32, title: s.d32, assignee: 'ai', questionIds: ['Q-13'] },
      ]
    : [];

  const approvals: MockExchange[] = [
    ...plans.map(
      (plan): MockExchange => ({
        id: plan.epicId,
        type: 'approval',
        from: 'ai',
        to: 'human',
        turn: 'human',
        title: `${plan.epicId} ${plan.epicName}`,
        createdAt: '2026-11-17T08:45:00.000Z',
        tasks: plan.tasks.map((task) => task.id),
        epicId: plan.epicId,
      }),
    ),
    ...drafts.map(
      (draft): MockExchange => ({
        id: `#${draft.id}`,
        type: 'approval',
        from: 'ai',
        to: 'human',
        turn: 'human',
        title: draft.title,
        createdAt: '2026-11-17T08:30:00.000Z',
        tasks: [draft.id],
        epicId: null,
      }),
    ),
  ];
  // The question of the plan exists only with that plan.
  const questions = withNew && !answered ? [q12, q13] : [q13];

  return {
    exchanges: [...questions, ...approvals, r14, r11, q9].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    ),
    plans,
    drafts,
    lanes: {
      todo: [
        card(14, s.l14, 'todo', { assignee: 'human' }),
        card(15, s.l15, 'todo'),
        card(16, s.l16, 'todo'),
      ],
      doing: [
        card(41, s.l41, 'doing', { agentStatus: 'running', acceptance: { done: 1, total: 3 } }),
        card(42, s.l42, 'doing', { agentStatus: 'running' }),
      ],
      done: [
        card(43, s.l43, 'done', { acceptance: { done: 2, total: 2 } }),
        card(44, s.l44, 'done', { assignee: 'human', acceptance: { done: 2, total: 2 } }),
      ],
    },
  };
}

/** The questions a plan or draft still waits on. */
export function openQuestionsOf(fixture: Fixture, ids: string[]): MockExchange[] {
  return fixture.exchanges.filter(
    (exchange) => ids.includes(exchange.id) && exchange.type === 'question' && exchange.turn,
  );
}

/** The counts of the band: open questions and approvals from the AI, and your requests not yet accepted. */
export function countExchanges(exchanges: MockExchange[]) {
  const fromAi = exchanges.filter((e) => e.turn === 'human');
  const fromYou = exchanges.filter((e) => e.type === 'request' && e.turn === 'ai');
  return {
    fromAi: fromAi.length,
    questions: fromAi.filter((e) => e.type === 'question').length,
    approvals: fromAi.filter((e) => e.type === 'approval').length,
    fromYou: fromYou.length,
  };
}
