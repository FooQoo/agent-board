import { useTranslation } from 'react-i18next';

/** The strings this mock adds; the rest come from the product's dictionaries. */
const ja = {
  tab: 'サマリー',
  unread: '未読',
  read: '既読',
  delete: 'このサマリーを削除',
  emptyTitle: 'サマリーはまだありません',
  emptyBody: '成果が記録されると、1時間ごとにここへまとめます。',
  otherTab: '（この一覧は既存の画面と同じです）',
  itemsLabel: 'サマリーの一覧',
  resultsLabel: '記録された成果',
};

const en: typeof ja = {
  tab: 'Summary',
  unread: 'Unread',
  read: 'Read',
  delete: 'Delete this summary',
  emptyTitle: 'No summaries yet',
  emptyBody: 'Once results are recorded, they are gathered here every hour.',
  otherTab: '(This list is the same as the existing screen)',
  itemsLabel: 'Summaries',
  resultsLabel: 'Recorded results',
};

export type MockText = typeof ja;

export function useMockText(): MockText {
  const { i18n } = useTranslation();
  return i18n.language.startsWith('ja') ? ja : en;
}

export function useIsJa(): boolean {
  const { i18n } = useTranslation();
  return i18n.language.startsWith('ja');
}
