import { useTranslation } from 'react-i18next';

/** The strings this mock adds; the rest come from the product's dictionaries. */
const ja = {
  attach: 'タスクを添付',
  attachCount: (n: number) => `タスクを添付 (${n})`,
  pickerTitle: 'タスクを添付',
  search: 'タスクを検索（番号・タイトル）',
  confirm: (n: number) => `添付 (${n})`,
  cancel: '閉じる',
  recent: '最近・進行中',
  lane: { todo: '未着手', doing: '進行中', done: '完了' },
  hint: '# に続けて番号かタイトルを入力',
  none: '該当するタスクがありません。',
  lineNote: '最後の行にタスク番号が入ります',
};

const en: typeof ja = {
  attach: 'Attach task',
  attachCount: (n) => `Attach task (${n})`,
  pickerTitle: 'Attach tasks',
  search: 'Search tasks (number or title)',
  confirm: (n) => `Attach (${n})`,
  cancel: 'Close',
  recent: 'Recent and active',
  lane: { todo: 'To do', doing: 'Doing', done: 'Done' },
  hint: 'Type a number or title after #',
  none: 'No matching tasks.',
  lineNote: 'The ids are added as the last line',
};

export type MockText = typeof ja;

export function useMockText(): MockText {
  const { i18n } = useTranslation();
  return i18n.language.startsWith('ja') ? ja : en;
}

export function useLocale(): 'ja' | 'en' {
  const { i18n } = useTranslation();
  return i18n.language.startsWith('ja') ? 'ja' : 'en';
}
