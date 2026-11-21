import type { TaskResult } from '../../shared/api/contracts';

/** A picture drawn as a data URI, so no file or network is needed. */
export const PICTURE = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="320" height="200" fill="#dbeafe"/><rect x="20" y="20" width="280" height="30" fill="#3b82f6"/><rect x="20" y="70" width="180" height="16" fill="#93c5fd"/><rect x="20" y="100" width="220" height="16" fill="#93c5fd"/></svg>',
)}`;

/** One result line of a summary; `version` is what the link needs and the server must now record. */
export interface MockResult {
  taskId: number;
  version: number;
  title: string;
  picture: boolean;
}

export interface MockSummary {
  id: string;
  window: string;
  results: MockResult[];
}

const titles: Record<number, { ja: string; en: string }> = {
  552: {
    ja: 'スマホのボードを引っ張って更新にする',
    en: 'Make the phone board refresh by pulling down',
  },
  556: {
    ja: '受け入れ条件の編集中に別の端末で更新があったときの警告を分かりやすくする',
    en: 'Make the warning clearer when another device updates acceptance conditions while you are editing them',
  },
  551: {
    ja: '設定ダイアログのテーマ見本を見やすくする',
    en: 'Make the theme swatches in the settings dialog easier to read',
  },
  549: {
    ja: 'プロジェクト切り替えの一覧を検索できるようにする',
    en: 'Make the project switcher list searchable',
  },
};

const pick = (id: number, ja: boolean) => titles[id]?.[ja ? 'ja' : 'en'] ?? '';

export function buildSummaries(ja: boolean): MockSummary[] {
  const r = (taskId: number, version: number, picture: boolean): MockResult => ({
    taskId,
    version,
    title: pick(taskId, ja),
    picture,
  });
  return [
    { id: 's1', window: '11/20 09:00–10:00', results: [r(552, 2, true), r(556, 1, false)] },
    { id: 's2', window: '11/19 22:00–23:00', results: [r(551, 3, true)] },
    { id: 's3', window: '11/19 07:00–08:00', results: [r(549, 1, false), r(552, 1, false)] },
  ];
}

/** The results the destination shows: the task's results tab, with the linked version highlighted. */
export function destinationResults(ja: boolean): TaskResult[] {
  return [
    {
      version: 1,
      key: 'first',
      kind: 'progress',
      title: ja ? '引っ張る操作を追加' : 'Pull gesture added',
      summary: ja ? '下に引っ張ると更新されます。' : 'Pulling down refreshes the board.',
      at: '2026-11-20T00:10:00Z',
    },
    {
      version: 2,
      key: 'second',
      kind: 'final',
      title: ja
        ? 'スマホのボードを引っ張って更新にした'
        : 'The phone board refreshes by pulling down',
      summary: ja
        ? '更新中の表示と失敗時の案内まで組み込みました。'
        : 'The refreshing indicator and the failure notice are in.',
      attachmentId: 'shot-1',
      at: '2026-11-20T00:40:00Z',
    },
  ];
}
