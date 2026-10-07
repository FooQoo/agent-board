import { commonEn } from './locales/en/common';
import { detailEn } from './locales/en/detail';
import { editEn } from './locales/en/edit';
import { commonJa } from './locales/ja/common';
import { detailJa } from './locales/ja/detail';
import { editJa } from './locales/ja/edit';

// One namespace (`translation`), assembled from one file per area: shared, card details, editing.
export const resources = {
  en: { translation: { ...commonEn, ...detailEn, ...editEn } },
  ja: { translation: { ...commonJa, ...detailJa, ...editJa } },
} as const;
