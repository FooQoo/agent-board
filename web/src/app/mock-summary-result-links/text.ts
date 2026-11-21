import { useTranslation } from 'react-i18next';

/** The strings this mock adds; the rest come from the product's dictionaries. */
const ja = {
  openResult: (id: number, version: number) => `#${id} の結果 v${version} を開く`,
  version: (version: number) => `結果 v${version}`,
  back: '一覧へ戻る',
  destination: (_id: number) => '結果',
  noImage: '画像なし',
};

const en: typeof ja = {
  openResult: (id, version) => `Open result v${version} of #${id}`,
  version: (version) => `Result v${version}`,
  back: 'Back to the list',
  destination: (_id) => 'Results',
  noImage: 'No image',
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
