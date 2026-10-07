import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';

export interface OutlineItem {
  /** The heading text without the `## ` marker. */
  text: string;
  /** Offset of the heading's first character. */
  from: number;
}

const H2_NODES = new Set(['ATXHeading2', 'SetextHeading2']);
/** Parsing a description of the maximum size takes a few milliseconds; this is only a safety net. */
const PARSE_BUDGET_MS = 2000;

/**
 * The `##` headings of a Markdown text, read from its syntax tree. A `##` inside a code block is
 * not a heading in the tree, so it is not listed.
 */
export function outlineOf(source: string): OutlineItem[] {
  if (source === '') return [];
  const state = EditorState.create({
    doc: source,
    extensions: [markdown({ base: markdownLanguage })],
  });
  const tree = ensureSyntaxTree(state, state.doc.length, PARSE_BUDGET_MS);
  if (tree === null) return [];
  const items: OutlineItem[] = [];
  tree.iterate({
    enter(node) {
      if (!H2_NODES.has(node.name)) return;
      const raw = state.sliceDoc(node.from, node.to);
      const first = raw.split('\n')[0] ?? '';
      const text = (node.name === 'ATXHeading2' ? first.replace(/^#{2}[ \t]*/, '') : first)
        .replace(/[ \t]+#+[ \t]*$/, '')
        .trim();
      items.push({ text, from: node.from });
      return false;
    },
  });
  return items;
}

/** The heading the position belongs to: the last one at or before it, or -1 before the first. */
export function activeOutlineIndex(items: readonly OutlineItem[], position: number): number {
  let active = -1;
  for (const [index, item] of items.entries()) {
    if (item.from <= position) active = index;
    else break;
  }
  return active;
}
