import type { Heading } from 'mdast';
import { visit } from 'unist-util-visit';
import { parseMarkdown } from '../../lib/markdown/parse';

export interface OutlineItem {
  /** The heading text without the `## ` marker. */
  text: string;
  /** Offset of the heading's first character. */
  from: number;
}

/**
 * The `##` headings of a Markdown text, read from its syntax tree. A `##` inside a code block is
 * not a heading in the tree, so it is not listed. The parser is the one the Markdown view uses, so
 * the outline needs nothing from the editor's own bundle.
 */
export function outlineOf(source: string): OutlineItem[] {
  if (source === '') return [];
  const items: OutlineItem[] = [];
  visit(parseMarkdown(source), 'heading', (node: Heading) => {
    const from = node.position?.start.offset;
    const to = node.position?.end.offset;
    if (node.depth !== 2 || from === undefined || to === undefined) return;
    const first = source.slice(from, to).split('\n')[0] ?? '';
    const text = first
      .replace(/^#{2}(?=[ \t]|$)[ \t]*/, '')
      .replace(/[ \t]+#+[ \t]*$/, '')
      .replace(/^#+$/, '')
      .trim();
    items.push({ text, from });
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
