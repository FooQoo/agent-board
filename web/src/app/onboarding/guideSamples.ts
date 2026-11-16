// The guide's two sample cards and the question on the second one. They exist only in the
// browser: the cards are plain `TaskSummary` values with IDs no real task can have, and the
// guide draws them over the board without ever writing them to it.

import type { Choice, TaskSummary } from '../../shared/api/contracts';
import type { GuidePhase } from './guideTiming';

export type GuideLocale = 'en' | 'ja';

/** The sample cards' IDs: real tasks count up from 1, so these never clash with a task. */
export const FIRST_SAMPLE_ID = -1;
export const SECOND_SAMPLE_ID = -2;
const QUESTION_ID = 'guide-question';

const TEXT: Record<GuideLocale, { titles: [string, string]; criteria: [string, string] }> = {
  ja: {
    titles: ['サンプル：使い方を確認する', 'サンプル：案内の見せ方を選ぶ'],
    criteria: ['サンプルの進行を確認する', 'サンプルの回答を確認する'],
  },
  en: {
    titles: ['Sample: follow a task', 'Sample: choose the guide style'],
    criteria: ["Confirm the sample's progress", "Confirm the sample's answer"],
  },
};

const QUESTION: Record<GuideLocale, { question: string; choices: Choice[] }> = {
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

/** The question the second sample asks: its text and its options. */
export function sampleQuestion(locale: GuideLocale) {
  return { ...QUESTION[locale], title: TEXT[locale].titles[1] };
}

/** The lane the step is about: the first card's lane, then the second card's. */
export function focusOrdinal(phase: GuidePhase): 1 | 2 {
  return phase === 'samples' || phase === 'first-running' || phase === 'first-done' ? 1 : 2;
}

/** The two sample cards as `phase` shows them, in the order the guide frames them. */
export function sampleCards(locale: GuideLocale, phase: GuidePhase, at: string): TaskSummary[] {
  const text = TEXT[locale];
  const base = (id: number, ordinal: 0 | 1, met = false): TaskSummary => ({
    id,
    title: text.titles[ordinal],
    assignee: 'ai',
    taskStatus: 'todo',
    taskStatusChangedAt: at,
    position: 1,
    agentStatus: 'idle',
    agentStatusChangedAt: at,
    pendingReason: null,
    pendingRequestId: null,
    pendingChoices: [],
    openQuestionIds: [],
    epic: null,
    createdAt: at,
    updatedAt: at,
    isDraft: false,
    acceptance: [{ id: 'AC-1', text: text.criteria[ordinal], done: met }],
  });
  const first = base(FIRST_SAMPLE_ID, 0);
  const second = base(SECOND_SAMPLE_ID, 1);
  const done = (card: TaskSummary): TaskSummary => ({
    ...base(card.id, card.id === FIRST_SAMPLE_ID ? 0 : 1, true),
    taskStatus: 'done',
  });
  const doing = (card: TaskSummary, agentStatus: 'running' | 'pending'): TaskSummary => ({
    ...card,
    taskStatus: 'doing',
    agentStatus,
  });
  switch (phase) {
    case 'samples':
      return [first, second];
    case 'first-running':
      return [doing(first, 'running'), second];
    case 'first-done':
      return [done(first), second];
    case 'question': {
      const { question, choices } = QUESTION[locale];
      return [
        done(first),
        {
          ...doing(second, 'pending'),
          pendingReason: question,
          pendingRequestId: QUESTION_ID,
          pendingChoices: choices,
        },
      ];
    }
    case 'second-running':
      return [done(first), doing(second, 'running')];
    case 'second-done':
      return [done(first), done(second)];
  }
}
