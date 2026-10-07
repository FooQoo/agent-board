import type { Root } from 'mdast';
import { normalizeNewlines, parseMarkdown } from './parse';

function countListItems(node: { type: string; children?: unknown[] }): number {
  let total = node.type === 'listItem' ? 1 : 0;
  for (const child of node.children ?? []) {
    total += countListItems(child as { type: string; children?: unknown[] });
  }
  return total;
}

/**
 * The count shown on a section: the number of list items (nested ones included). Without any
 * list, the number of content blocks (paragraphs, tables, code, quotes). Headings and thematic
 * breaks are not content.
 */
export function countItems(sectionMarkdown: string): number {
  const tree: Root = parseMarkdown(normalizeNewlines(sectionMarkdown));
  const items = countListItems(tree);
  if (items > 0) return items;
  return tree.children.filter((node) => node.type !== 'heading' && node.type !== 'thematicBreak')
    .length;
}
