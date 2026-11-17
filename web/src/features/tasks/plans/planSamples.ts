import type { Epic } from '../../../shared/api/contracts';
import type { Plan } from './model/plan';

/** The project the sample plans belong to. */
export const SAMPLE_PROJECT = 'ef18518df6e300bf1eaa428610782f97';

const text = {
  ja: {
    epicName: 'ログインの刷新',
    goal: 'パスワードだけのログインをやめ、メールのリンクと端末の認証で入れるようにします。',
    goalMore: '既存のアカウントは、最初のログインで自動的に移行します。',
    t21: 'ログイン画面を作り直す',
    t22: 'メールのリンクでの認証を追加する',
    t23: '端末の認証に対応する',
    t24: '移行の案内文を確認する',
    t25: '古いログインを止める',
    q12: 'パスワードでのログインは残しますか？',
    addedA: '検索結果に絞り込みを加える',
    addedB: '絞り込みの文言を確認する',
    single: 'エラー画面の文言を直す',
    searchName: '検索の改善',
  },
  en: {
    epicName: 'Rework sign-in',
    goal: 'Stop signing in with a password alone: let people in with an email link or a device check.',
    goalMore: 'Existing accounts move over automatically the first time they sign in.',
    t21: 'Rebuild the sign-in screen',
    t22: 'Add sign-in by email link',
    t23: 'Support device verification',
    t24: 'Check the wording of the move notice',
    t25: 'Turn off the old sign-in',
    q12: 'Keep password sign-in?',
    addedA: 'Add filters to the search results',
    addedB: 'Check the filter wording',
    single: 'Fix the wording of the error page',
    searchName: 'Improve search',
  },
} as const;

const textOf = (language: string) => text[language.startsWith('ja') ? 'ja' : 'en'];

/** The goal text of the sample epic, as its `EPIC.md` body. */
export function sampleEpic(language: string): Epic {
  const s = textOf(language);
  const body = `${s.goal}\n\n${s.goalMore}\n`;
  return {
    id: 'LOGIN-1',
    name: s.epicName,
    color: '#3b82f6',
    draft: 'ai',
    document: `---\nname: ${s.epicName}\n---\n${body}`,
    body,
    priority: [21, 22, 23, 24, 25],
    priorityError: false,
    attachments: [],
    createdAt: '2026-11-17T08:45:00.000Z',
    updatedAt: '2026-11-17T08:45:00.000Z',
  };
}

/** A new epic with five tasks, waiting on one question unless `answered`. */
export function newEpicPlan(language: string, answered = false): Plan {
  const s = textOf(language);
  return {
    id: 'LOGIN-1',
    kind: 'new',
    epicId: 'LOGIN-1',
    epicName: s.epicName,
    tasks: [
      { id: 21, title: s.t21, assignee: 'ai', acceptance: 3 },
      { id: 22, title: s.t22, assignee: 'ai', acceptance: 2 },
      { id: 23, title: s.t23, assignee: 'ai', acceptance: 2 },
      { id: 24, title: s.t24, assignee: 'human', acceptance: 1 },
      { id: 25, title: s.t25, assignee: 'ai', acceptance: 2 },
    ],
    questions: answered ? [] : [{ id: 'Q-12', title: s.q12 }],
  };
}

/** Two tasks added to an epic that is already running. */
export function addedPlan(language: string): Plan {
  const s = textOf(language);
  return {
    id: 'SEARCH-2',
    kind: 'added',
    epicId: 'SEARCH-2',
    epicName: s.searchName,
    tasks: [
      { id: 26, title: s.addedA, assignee: 'ai', acceptance: 2 },
      { id: 27, title: s.addedB, assignee: 'human', acceptance: 1 },
    ],
    questions: [],
  };
}

/** One AI-draft task that belongs to no epic. */
export function singlePlan(language: string, blocked = false): Plan {
  const s = textOf(language);
  return {
    id: '#31',
    kind: 'single',
    epicId: null,
    epicName: '',
    tasks: [{ id: 31, title: s.single, assignee: 'ai', acceptance: 1 }],
    questions: blocked ? [{ id: 'Q-13', title: s.q12 }] : [],
  };
}
