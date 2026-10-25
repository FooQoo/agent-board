import { i18n } from './index';
import { docsEn } from './locales/en/docs';
import { docsDocumentEn } from './locales/en/docsDocument';
import { docsJa } from './locales/ja/docs';
import { docsDocumentJa } from './locales/ja/docsDocument';

// The Docs dialog's text is registered by the Docs code, not by the shared resources, so pages that
// never open the Docs (such as the board's first load) do not carry it. Import this module before
// rendering any Docs view.
i18n.addResourceBundle('en', 'translation', { ...docsEn, ...docsDocumentEn }, true, true);
i18n.addResourceBundle('ja', 'translation', { ...docsJa, ...docsDocumentJa }, true, true);
