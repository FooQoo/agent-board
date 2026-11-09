import type { Task } from '../../../shared/api/contracts.ts';
import type { MockContext } from './types.ts';
import { taskChange, taskChangeOf, taskMarkdown } from './wire.ts';

// The guide's two sample cards and the card steps of a run, as `agboard serve` takes them
// (`src/file_store/ops/onboarding/cards.rs`): the guide plays the AI that works on them.

export type GuideLocale = 'en' | 'ja';

const SAMPLE_CRITERION = 'AC-1';

const SAMPLES: Record<GuideLocale, Array<{ title: string; body: string; criterion: string }>> = {
  ja: [
    {
      title: 'サンプル：使い方を確認する',
      body: 'ガイド用のサンプルです。実際のAIは動きません。',
      criterion: 'サンプルの進行を確認する',
    },
    {
      title: 'サンプル：案内の見せ方を選ぶ',
      body: 'ガイド用のサンプルです。実際のAIは動きません。',
      criterion: 'サンプルの回答を確認する',
    },
  ],
  en: [
    {
      title: 'Sample: follow a task',
      body: 'This is a guide sample. No AI agent works on it.',
      criterion: "Confirm the sample's progress",
    },
    {
      title: 'Sample: choose the guide style',
      body: 'This is a guide sample. No AI agent works on it.',
      criterion: "Confirm the sample's answer",
    },
  ],
};

const QUESTIONS: Record<GuideLocale, { question: string; choices: Task['pendingChoices'] }> = {
  ja: {
    question: '案内の文章は、どちらが読みやすいですか？',
    choices: [
      { id: 'brief', label: '短く、要点だけ' },
      { id: 'detailed', label: '背景も含めて詳しく' },
    ],
  },
  en: {
    question: 'Which explanation is easier to read?',
    choices: [
      { id: 'brief', label: 'Keep it brief' },
      { id: 'detailed', label: 'Include more context' },
    ],
  },
};

function cardOf(context: MockContext, projectId: string, id: number): Task | undefined {
  return context.boards()[projectId]?.tasks.find((task) => task.id === id);
}

/** Stores `updated` in place of its card, and reports the change of the card. */
function save(context: MockContext, projectId: string, before: Task, updated: Task): void {
  const board = context.boards()[projectId];
  if (!board) return;
  context.replaceTasks(board, [updated], [taskChangeOf(before, updated, ['summary', 'history'])]);
}

/** The card of this run with the given ordinal, if it was created. */
export function findSample(
  context: MockContext,
  projectId: string,
  runId: string,
  ordinal: number,
): number | null {
  const found = context
    .boards()
    [projectId]?.tasks.find(
      (task) => task.onboardingSample?.runId === runId && task.onboardingSample.ordinal === ordinal,
    );
  return found?.id ?? null;
}

/** Creates the sample card `ordinal` of the run in Todo, as the AI's card; returns its ID. */
export function createSample(
  context: MockContext,
  projectId: string,
  runId: string,
  ordinal: 1 | 2,
  locale: GuideLocale,
): number | null {
  const board = context.boards()[projectId];
  const text = SAMPLES[locale][ordinal - 1];
  if (!board || !text) return null;
  const at = context.now();
  const id = Math.max(0, ...board.tasks.map((task) => task.id)) + 1;
  const acceptance = [{ id: SAMPLE_CRITERION, text: text.criterion, done: false }];
  const history = [{ at, reason: 'Created task in Todo.' }];
  const task: Task = {
    id,
    title: text.title,
    description: taskMarkdown(text.body, acceptance, history),
    body: text.body,
    acceptance,
    acceptanceError: false,
    assignee: 'ai',
    taskStatus: 'todo',
    taskStatusChangedAt: at,
    position:
      board.tasks.filter((item) => item.taskStatus === 'todo' && !item.archivedAt).length + 1,
    agentStatus: 'idle',
    pendingReason: null,
    pendingRequestId: null,
    pendingChoices: [],
    onboardingSample: { runId, ordinal },
    epic: null,
    createdAt: at,
    updatedAt: at,
    agentStatusChangedAt: at,
    isDraft: false,
    archivedAt: null,
    history,
    attachments: [],
  };
  context.commit(projectId, { ...board, tasks: [...board.tasks, task] }, [
    taskChange(id, ['summary']),
  ]);
  return id;
}

/** The card in Doing, at the end of the lane, with `reason` in its history. */
function toDoing(context: MockContext, projectId: string, task: Task, reason: string): Task {
  if (task.taskStatus !== 'todo') return task;
  const board = context.boards()[projectId];
  const doing = board?.tasks.filter((item) => item.taskStatus === 'doing' && !item.archivedAt);
  const at = context.now();
  const updated: Task = {
    ...task,
    taskStatus: 'doing',
    taskStatusChangedAt: at,
    position: Math.max(0, ...(doing ?? []).map((item) => item.position)) + 1,
    updatedAt: at,
    history: [...task.history, { at, reason }],
  };
  save(context, projectId, task, updated);
  return updated;
}

/** Puts the card in Running, if it is not already. */
export function setRunning(context: MockContext, projectId: string, id: number): void {
  const task = cardOf(context, projectId, id);
  if (!task || task.agentStatus === 'running') return;
  const at = context.now();
  save(context, projectId, task, {
    ...task,
    agentStatus: 'running',
    agentStatusChangedAt: at,
    pendingReason: null,
    pendingRequestId: null,
    pendingChoices: [],
    updatedAt: at,
    history: [...task.history, { at, reason: 'Guide: the card resumes.' }],
  });
}

/** Puts the first card into Doing and Running, as the scripted run does. */
export function startCard(context: MockContext, projectId: string, id: number): void {
  const task = cardOf(context, projectId, id);
  if (!task) return;
  toDoing(context, projectId, task, 'Guide: the first card starts.');
  setRunning(context, projectId, id);
}

/** Marks the card's one condition met; the automatic Done after the write moves it to Done. */
export function finishCard(context: MockContext, projectId: string, id: number): void {
  const task = cardOf(context, projectId, id);
  if (!task || task.taskStatus === 'done') return;
  const acceptance = task.acceptance.map((item) => ({ ...item, done: true }));
  const board = context.boards()[projectId];
  if (!board) return;
  const updated: Task = {
    ...task,
    acceptance,
    description: taskMarkdown(task.body, acceptance, task.history),
    updatedAt: context.now(),
  };
  context.replaceTasks(board, [updated], [taskChange(id, ['summary', 'document'])]);
}

/** Moves the second card to Doing and asks the question; returns the request ID. */
export function askCard(
  context: MockContext,
  projectId: string,
  id: number,
  locale: GuideLocale,
  requestId: string,
): string | null {
  const task = cardOf(context, projectId, id);
  if (!task) return null;
  const doing = toDoing(context, projectId, task, 'Guide: the second card starts.');
  const { question, choices } = QUESTIONS[locale];
  const at = context.now();
  save(context, projectId, doing, {
    ...doing,
    agentStatus: 'pending',
    agentStatusChangedAt: at,
    pendingReason: question,
    pendingRequestId: requestId,
    pendingChoices: structuredClone(choices),
    updatedAt: at,
    history: [...doing.history, { at, reason: question }],
  });
  return requestId;
}

/** Whether the second card's question `requestId` has been answered. */
export function answered(
  context: MockContext,
  projectId: string,
  id: number,
  requestId: string,
): boolean {
  const task = cardOf(context, projectId, id);
  return task !== undefined && task.pendingRequestId !== requestId;
}

/** Archives every card of the run that is not archived yet, wherever it is in the lanes. */
export function archiveSamples(context: MockContext, projectId: string, runId: string): void {
  const board = context.boards()[projectId];
  if (!board) return;
  const at = context.now();
  const samples = board.tasks.filter(
    (task) => task.onboardingSample?.runId === runId && !task.archivedAt,
  );
  if (samples.length === 0) return;
  const archived = samples.map(
    (task): Task => ({
      ...task,
      archivedAt: at,
      agentStatus: 'idle',
      pendingReason: null,
      pendingRequestId: null,
      pendingChoices: [],
    }),
  );
  context.replaceTasks(
    board,
    archived,
    archived.map((task, index) => taskChangeOf(samples[index], task, ['summary'])),
  );
}
