import { commonEn } from './locales/en/common';
import { detailEn } from './locales/en/detail';
import { docsEn } from './locales/en/docs';
import { docsDocumentEn } from './locales/en/docsDocument';
import { editEn } from './locales/en/edit';
import { monitorEn } from './locales/en/monitor';
import { commonJa } from './locales/ja/common';
import { detailJa } from './locales/ja/detail';
import { docsJa } from './locales/ja/docs';
import { docsDocumentJa } from './locales/ja/docsDocument';
import { editJa } from './locales/ja/edit';
import { monitorJa } from './locales/ja/monitor';

// One namespace (`translation`), assembled from one file per area: shared, card details, docs, editing, and monitor.
export const resources = {
  en: {
    translation: {
      ...commonEn,
      ...detailEn,
      ...docsEn,
      ...docsDocumentEn,
      ...editEn,
      ...monitorEn,
      archive: { ...commonEn.archive, ...detailEn.archive },
    },
  },
  ja: {
    translation: {
      ...commonJa,
      ...detailJa,
      ...docsJa,
      ...docsDocumentJa,
      ...editJa,
      ...monitorJa,
      archive: { ...commonJa.archive, ...detailJa.archive },
    },
  },
} as const;
