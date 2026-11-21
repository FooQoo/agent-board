// The guide's sample request, the plan the pretend agent makes from it, and the question it asks.
// They exist only in the browser: the cards are plain `TaskSummary` values with IDs no real task
// can have, and the guide draws them over the board without ever writing them to it.

import type { Choice, EpicRef, TaskSummary } from '../../shared/api/contracts';
import type { GuidePhase } from './guideTiming';

export type GuideLocale = 'en' | 'ja';

/** The sample cards' IDs: real tasks count up from 1, so these never clash with a task. */
export const SAMPLE_IDS = [-1, -2, -3] as const;
const QUESTION_ID = 'guide-question';

interface Text {
  request: string;
  epic: string;
  titles: [string, string, string];
  criteria: [[string, string], [string, string], [string, string]];
  question: string;
  choices: Choice[];
}

const TEXT: Record<GuideLocale, Text> = {
  ja: {
    request:
      '月次レポートを用意してください。今月の数値を集めて、要約を書き、チームに共有してほしいです。',
    epic: '月次レポート',
    titles: ['今月の数値を集める', '要約を書く', 'チームに共有する'],
    criteria: [
      ['数値が1つの表にまとまっている', '各数値の出典が書かれている'],
      ['要約が1ページに収まっている', '主な変化に触れている'],
      ['チームがレポートを受け取っている', 'リンクがチームのチャンネルに投稿されている'],
    ],
    question: '集計の対象は、どの期間にしますか？',
    choices: [
      { id: 'month', label: '今月だけ' },
      { id: 'quarter', label: '直近3か月' },
    ],
  },
  en: {
    request:
      "Prepare the monthly report: gather this month's numbers, write a summary, and share it with the team.",
    epic: 'Monthly report',
    titles: ["Gather this month's numbers", 'Write the summary', 'Share it with the team'],
    criteria: [
      ['The figures are collected in one sheet', 'Each figure has its source noted'],
      ['The summary fits on one page', 'It covers the main changes'],
      ['The team has the report', 'The link is posted in the team channel'],
    ],
    question: 'Which period should the figures cover?',
    choices: [
      { id: 'month', label: 'This month only' },
      { id: 'quarter', label: 'The last three months' },
    ],
  },
};

/** The request the guide offers to send: it is what the pretend agent turns into a plan. */
export function sampleRequest(locale: GuideLocale): string {
  return TEXT[locale].request;
}

/** The question the pretend agent asks: its text and its options. */
export function sampleQuestion(locale: GuideLocale) {
  const { question, choices, titles } = TEXT[locale];
  return { question, choices, title: titles[0] };
}

/** The lane the step is about; `null` while the request is still being written. */
export function focusColumn(phase: GuidePhase): 'backlog' | 'todo' | 'doing' | 'done' | null {
  switch (phase) {
    case 'request':
      return null;
    case 'planned':
      return 'backlog';
    case 'question':
      return 'todo';
    case 'started':
      return 'doing';
    case 'done':
      return 'done';
  }
}

/** The sample cards as `phase` shows them, in the order the guide frames them. */
export function sampleCards(locale: GuideLocale, phase: GuidePhase, at: string): TaskSummary[] {
  const text = TEXT[locale];
  const epic: EpicRef = { id: 'SAMPLE-1', name: text.epic, color: '#6d5bd0' };
  const card = (index: 0 | 1 | 2, met: [boolean, boolean]): TaskSummary => ({
    id: SAMPLE_IDS[index],
    title: text.titles[index],
    assignee: 'ai',
    taskStatus: 'todo',
    taskStatusChangedAt: at,
    position: index + 1,
    agentStatus: 'idle',
    agentStatusChangedAt: at,
    pendingReason: null,
    pendingRequestId: null,
    pendingChoices: [],
    openQuestionIds: [],
    epic,
    createdAt: at,
    updatedAt: at,
    draft: null,
    acceptance: text.criteria[index].map((condition, position) => ({
      id: `AC-${position + 1}`,
      text: condition,
      done: met[position] ?? false,
    })),
  });
  // The plan waits in the Backlog until the person sends it to Todo.
  const draft = (index: 0 | 1 | 2): TaskSummary => ({
    ...card(index, [false, false]),
    taskStatus: 'backlog',
  });
  switch (phase) {
    case 'request':
      return [];
    case 'planned':
      return [draft(0), draft(1), draft(2)];
    case 'question':
      return [
        {
          // The person sent the first plan to Todo, where the agent asks before it starts.
          ...card(0, [false, false]),
          agentStatus: 'pending',
          pendingReason: text.question,
          pendingRequestId: QUESTION_ID,
          pendingChoices: text.choices,
        },
        draft(1),
        draft(2),
      ];
    case 'started':
      return [
        { ...card(0, [true, false]), taskStatus: 'doing', agentStatus: 'running' },
        card(1, [false, false]),
        card(2, [false, false]),
      ];
    case 'done':
      return [0, 1, 2].map((index) => ({
        ...card(index as 0 | 1 | 2, [true, true]),
        taskStatus: 'done' as const,
      }));
  }
}
