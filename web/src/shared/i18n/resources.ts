import { commonEn } from './locales/en/common';
import { detailEn } from './locales/en/detail';
import { editEn } from './locales/en/edit';
import { monitorEn } from './locales/en/monitor';
import { onboardingEn } from './locales/en/onboarding';
import { commonJa } from './locales/ja/common';
import { detailJa } from './locales/ja/detail';
import { editJa } from './locales/ja/edit';
import { monitorJa } from './locales/ja/monitor';
import { onboardingJa } from './locales/ja/onboarding';

// One namespace (`translation`), assembled from one file per area: shared, card details, editing, monitor, first-run guide.
export const resources = {
  en: {
    translation: {
      ...commonEn,
      ...detailEn,
      ...editEn,
      ...monitorEn,
      ...onboardingEn,
      archive: { ...commonEn.archive, ...detailEn.archive },
    },
  },
  ja: {
    translation: {
      ...commonJa,
      ...detailJa,
      ...editJa,
      ...monitorJa,
      ...onboardingJa,
      archive: { ...commonJa.archive, ...detailJa.archive },
    },
  },
} as const;
