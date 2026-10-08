import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { EditorView, keymap, placeholder } from '@codemirror/view';
import { tags } from '@lezer/highlight';

/*
 * Colors, fonts and spacing come from the app's CSS variables, so the editor follows the color
 * theme (light, dark, accent) without being rebuilt.
 */
const theme = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: 'var(--r-surface)',
    color: 'var(--r-text)',
    fontSize: '13px',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'var(--font-mono)',
    lineHeight: '21px',
    overflow: 'auto',
  },
  '.cm-content': { padding: '14px 0', caretColor: 'var(--r-accent)' },
  '.cm-line': { padding: '0 16px', position: 'relative' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--r-accent)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground':
    { background: 'color-mix(in srgb, var(--r-accent) 22%, transparent)' },
  // Keep the hint outside the empty line's layout so the native caret is one line tall.
  '.cm-placeholder': {
    color: 'var(--r-muted)',
    position: 'absolute',
    pointerEvents: 'none',
    maxWidth: 'calc(100% - 32px)',
  },
  '.cm-md-heading': { color: 'var(--r-accent)' },
  '.cm-md-strong': { fontWeight: '700' },
  '.cm-md-emphasis': { fontStyle: 'italic' },
  '.cm-md-strike': { textDecoration: 'line-through' },
  '.cm-md-link': { color: 'var(--r-accent)' },
  '.cm-md-quote, .cm-md-code': { color: 'var(--r-text2)' },
});

/** Syntax classes only: with a `class`, HighlightStyle applies it as is, and the theme styles it. */
const highlight = HighlightStyle.define([
  // The six heading levels only: a bare `tags.heading` would also color the header row of a table.
  {
    tag: [tags.heading1, tags.heading2, tags.heading3, tags.heading4, tags.heading5, tags.heading6],
    class: 'cm-md-heading',
  },
  { tag: tags.strong, class: 'cm-md-strong' },
  { tag: tags.emphasis, class: 'cm-md-emphasis' },
  { tag: tags.strikethrough, class: 'cm-md-strike' },
  { tag: [tags.link, tags.url], class: 'cm-md-link' },
  { tag: tags.quote, class: 'cm-md-quote' },
  { tag: tags.monospace, class: 'cm-md-code' },
]);

/** A placeholder of several lines, drawn as stacked lines in the editor's own font. */
export function placeholderExtension(text: string): Extension {
  if (text === '') return [];
  return placeholder(() => {
    const element = document.createElement('div');
    for (const line of text.split('\n')) {
      const row = document.createElement('div');
      row.textContent = line === '' ? ' ' : line;
      element.append(row);
    }
    return element;
  });
}

/**
 * Markdown (with GitHub-style tables and task lists), syntax colors, wrapping, undo and redo, and
 * the standard keys. `indentWithTab` is left out on purpose: Tab moves the focus on, so the editor
 * is never a keyboard trap.
 */
export const baseExtensions: Extension[] = [
  history(),
  keymap.of([...defaultKeymap, ...historyKeymap]),
  markdown({ base: markdownLanguage }),
  syntaxHighlighting(highlight),
  EditorView.lineWrapping,
  theme,
];
