export type Lang = 'ja' | 'en';

export interface FixtureCard {
  id: number;
  title: Record<Lang, string>;
  state: 'running' | 'pending' | 'idle' | 'done';
  tag: Record<Lang, string>;
}

/** Fixed cards of the board behind the bar. */
export const FIXTURE_CARDS: FixtureCard[] = [
  {
    id: 11,
    title: { ja: 'API のリファクタリング', en: 'API refactoring' },
    state: 'pending',
    tag: { ja: '回答待ち', en: 'Waiting' },
  },
  {
    id: 12,
    title: { ja: 'JSON からボードを復元する', en: 'Restore a board from JSON' },
    state: 'running',
    tag: { ja: '作業中', en: 'Running' },
  },
  {
    id: 13,
    title: {
      ja: '狭い画面でのボード表示を確認する',
      en: 'Check the board on a narrow screen',
    },
    state: 'idle',
    tag: { ja: '待機', en: 'Idle' },
  },
  {
    id: 14,
    title: { ja: 'セットアップガイドを書く', en: 'Write the setup guide' },
    state: 'idle',
    tag: { ja: '待機', en: 'Idle' },
  },
  {
    id: 15,
    title: { ja: '空のボードの表示を整える', en: 'Refine the empty board' },
    state: 'idle',
    tag: { ja: '待機', en: 'Idle' },
  },
];

export const FIXTURE_LANES: Record<Lang, string[]> = {
  ja: ['Todo', '進行中', '完了'],
  en: ['Todo', 'Doing', 'Done'],
};
