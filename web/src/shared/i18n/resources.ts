import { commonEn } from './locales/en/common';
import { dataLayerConnectionEn } from './locales/en/data-layer-connection';
import { dataLayerDetailEn } from './locales/en/data-layer-detail';
import { dataLayerMonitorEn } from './locales/en/data-layer-monitor';
import { dataLayerPcEn } from './locales/en/data-layer-pc';
import { detailEn } from './locales/en/detail';
import { editEn } from './locales/en/edit';
import { monitorEn } from './locales/en/monitor';
import { commonJa } from './locales/ja/common';
import { dataLayerConnectionJa } from './locales/ja/data-layer-connection';
import { dataLayerDetailJa } from './locales/ja/data-layer-detail';
import { dataLayerMonitorJa } from './locales/ja/data-layer-monitor';
import { dataLayerPcJa } from './locales/ja/data-layer-pc';
import { detailJa } from './locales/ja/detail';
import { editJa } from './locales/ja/edit';
import { monitorJa } from './locales/ja/monitor';

// One namespace (`translation`), assembled from one file per area: shared, card details, editing, and monitor.
export const resources = {
  en: {
    translation: {
      ...commonEn,
      ...detailEn,
      ...editEn,
      ...monitorEn,
      ...dataLayerConnectionEn,
      ...dataLayerDetailEn,
      ...dataLayerMonitorEn,
      ...dataLayerPcEn,
      archive: { ...commonEn.archive, ...detailEn.archive },
    },
  },
  ja: {
    translation: {
      ...commonJa,
      ...detailJa,
      ...editJa,
      ...monitorJa,
      ...dataLayerConnectionJa,
      ...dataLayerDetailJa,
      ...dataLayerMonitorJa,
      ...dataLayerPcJa,
      archive: { ...commonJa.archive, ...detailJa.archive },
    },
  },
} as const;
