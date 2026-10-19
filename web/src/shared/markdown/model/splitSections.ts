import { toString as nodeText } from 'mdast-util-to-string';
import { countItems } from './countItems';
import { normalizeNewlines, parseMarkdown } from './parse';

export interface Section {
  /** The plain text of the H2. */
  title: string;
  /** List items in the section, or its blocks when it has no list. */
  count: number;
  /** The Markdown under the heading, up to the next H2. */
  markdown: string;
}

export interface SplitResult {
  /** The text before the first H2. Always shown. */
  preamble: string;
  /** One entry per H2. Empty when the source has no H2. */
  sections: Section[];
}

/**
 * Splits a description at its H2 headings. The split uses the Markdown syntax tree, so a `##`
 * inside a code block, a quote or an indented block is not a heading.
 */
export function splitSections(source: string): SplitResult {
  const text = normalizeNewlines(source);
  const tree = parseMarkdown(text);
  const headings = tree.children.filter((node) => node.type === 'heading' && node.depth === 2);
  if (headings.length === 0) return { preamble: text.trim(), sections: [] };

  const offset = (value: number | undefined) => value ?? 0;
  const firstHeading = headings[0];
  const preamble = text.slice(0, offset(firstHeading?.position?.start.offset)).trim();
  const sections = headings.map((heading, index) => {
    const bodyStart = offset(heading.position?.end.offset);
    const next = headings[index + 1];
    const bodyEnd = next ? offset(next.position?.start.offset) : text.length;
    const markdown = text.slice(bodyStart, bodyEnd).trim();
    return { title: nodeText(heading), count: countItems(markdown), markdown };
  });
  return { preamble, sections };
}
