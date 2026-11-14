import { i18n } from './index';
import { questionFlowEn } from './locales/en/questionFlow';
import { questionFlowJa } from './locales/ja/questionFlow';

// The text of answering the questions in a row is registered by the dialog and the sheet, which load
// on first use, so the first screen of the board and the monitor does not carry it.
i18n.addResourceBundle('en', 'translation', questionFlowEn, true, true);
i18n.addResourceBundle('ja', 'translation', questionFlowJa, true, true);
