import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';

const KEYWORD = 'var(--r-text)';
const QUIET = 'var(--r-text2)';
const LITERAL = 'var(--r-pend-tx)';

const SPECS = [
  {
    tag: [tags.keyword, tags.modifier, tags.controlKeyword, tags.definitionKeyword],
    color: KEYWORD,
    fontWeight: '600',
  },
  { tag: [tags.heading, tags.strong], color: KEYWORD, fontWeight: '600' },
  { tag: [tags.comment, tags.meta], color: QUIET, fontStyle: 'italic' },
  {
    tag: [tags.string, tags.special(tags.string), tags.regexp, tags.number, tags.bool, tags.null],
    color: LITERAL,
  },
  { tag: [tags.link, tags.url], color: QUIET, textDecoration: 'underline' },
  { tag: tags.emphasis, fontStyle: 'italic' },
];

/** The colors the highlighting uses; all of them are page tokens (text, secondary, pending). */
export const CODE_HIGHLIGHT_COLORS: string[] = [KEYWORD, QUIET, LITERAL];

/**
 * Highlighting of the code blocks in the editor. CodeMirror's own default colors assume a light
 * page (blue on a dark page reads at about 1:1), so the editor colors tokens from the page tokens:
 * text, secondary text and the pending ink, which keep 4.5:1 on the code background in both
 * themes.
 */
export const codeHighlight = syntaxHighlighting(HighlightStyle.define(SPECS));
