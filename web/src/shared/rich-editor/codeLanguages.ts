import { markdown } from '@codemirror/lang-markdown';
import { LanguageDescription } from '@codemirror/language';
import { languages } from '@codemirror/language-data';

const MARKDOWN_LANGUAGE = LanguageDescription.of({
  name: 'Markdown',
  alias: ['md', 'markdown'],
  support: markdown(),
});

/** The languages offered for a code block, and the ones it highlights. */
export const CODE_LANGUAGES = [MARKDOWN_LANGUAGE, ...languages];
