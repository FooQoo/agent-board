import { i18n } from './index';
import { previewFeatureEn } from './locales/en/preview-feature';
import { previewFeatureJa } from './locales/ja/preview-feature';

// The public preview badge and notice register their own text, not the shared resources, so pages
// that show no preview feature (such as the board's first load) do not carry it. Import this module
// before rendering a preview badge or notice.
i18n.addResourceBundle('en', 'translation', previewFeatureEn, true, true);
i18n.addResourceBundle('ja', 'translation', previewFeatureJa, true, true);
