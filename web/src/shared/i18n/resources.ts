import { commonEn } from './locales/en/common';
import { detailEn } from './locales/en/detail';
import { editEn } from './locales/en/edit';
import { monitorEn } from './locales/en/monitor';
import { commonJa } from './locales/ja/common';
import { detailJa } from './locales/ja/detail';
import { editJa } from './locales/ja/edit';
import { monitorJa } from './locales/ja/monitor';

// One namespace (`translation`), assembled from one file per area: shared, card details, editing.
export const resources = {
  en: {
    translation: {
      ...commonEn,
      ...detailEn,
      ...editEn,
      ...monitorEn,
      archive: { ...commonEn.archive, ...detailEn.archive },
    },
  },
  ja: {
    translation: {
      ...commonJa,
      ...detailJa,
      ...editJa,
      ...monitorJa,
      archive: { ...commonJa.archive, ...detailJa.archive },
    },
  },
} as const;
