export type Lane = 'todo' | 'doing' | 'done';

export interface MockTask {
  id: number;
  lane: Lane;
  title: { ja: string; en: string };
  epic: { ja: string; en: string };
}

/** Fixed tasks the picker offers: recent and active first. */
export const TASKS: readonly MockTask[] = [
  {
    id: 552,
    lane: 'doing',
    title: {
      ja: '結果の履歴からタスクへ移動できるようにする',
      en: 'Jump from a result in the summary to its task',
    },
    epic: { ja: 'サマリー改善', en: 'Summary polish' },
  },
  {
    id: 651,
    lane: 'doing',
    title: {
      ja: 'カードにプロジェクト名を出さない',
      en: 'Hide the project name on cards',
    },
    epic: { ja: 'ボード表示', en: 'Board display' },
  },
  {
    id: 648,
    lane: 'todo',
    title: {
      ja: '通知の文言を短くする',
      en: 'Shorten the notification wording',
    },
    epic: { ja: 'ボード表示', en: 'Board display' },
  },
  {
    id: 640,
    lane: 'todo',
    title: {
      ja: '途中の担当交代を記録する',
      en: 'Record a mid-task change of assignee',
    },
    epic: { ja: '担当の割り振り', en: 'Agent assignment' },
  },
  {
    id: 559,
    lane: 'done',
    title: { ja: 'スマホの下書きを保存する', en: 'Keep the phone draft' },
    epic: { ja: 'サマリー改善', en: 'Summary polish' },
  },
  {
    id: 544,
    lane: 'done',
    title: { ja: '画像の貼り付けに対応する', en: 'Support pasting images' },
    epic: { ja: 'AI に依頼', en: 'Ask AI' },
  },
];

export const BASE_TEXT = {
  ja: 'ログインに失敗したときの文言が分かりにくい。原因を一言で出し、再入力しやすくしてほしい。',
  en: 'The message shown when sign-in fails is unclear. State the cause in one phrase and make it easy to retry.',
};

/** A last line made only of task references: `#552 #651`. */
const TRAILING = /(?:^|\n)[ \t]*((?:#\d+[ \t]*)+)$/;

/** Splits a request into its text and the task ids on its last line. */
export function splitTrailing(text: string): { body: string; ids: number[] } {
  const match = TRAILING.exec(text.replace(/\s+$/, ''));
  if (!match) return { body: text, ids: [] };
  const ids = [...(match[1] ?? '').matchAll(/#(\d+)/g)].map((m) => Number(m[1]));
  const body = text.replace(/\s+$/, '').slice(0, match.index);
  return { body, ids };
}

/** Replaces the existing last `#…` line (never adds a second one); no ids removes the line. */
export function withTasks(text: string, ids: readonly number[]): string {
  const { body } = splitTrailing(text);
  const head = body.replace(/\s+$/, '');
  return ids.length === 0 ? head : `${head}\n${ids.map((id) => `#${id}`).join(' ')}`;
}

/** The `#query` being typed at the very end of the text (option B), or null. */
export function openToken(text: string): string | null {
  const match = /(?:^|\n)(?:[ \t]*#\d+[ \t]+)*[ \t]*#([^\s#]*)$/.exec(text);
  return match ? (match[1] ?? '') : null;
}

export function matches(task: MockTask, query: string, locale: 'ja' | 'en'): boolean {
  const q = query.trim().replace(/^#/, '').toLowerCase();
  if (q === '') return true;
  return String(task.id).startsWith(q) || task.title[locale].toLowerCase().includes(q);
}
