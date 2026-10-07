import type { Root } from 'mdast';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

const processor = unified().use(remarkParse).use(remarkGfm);

/** Parses GitHub-flavored Markdown into a syntax tree with source positions. */
export function parseMarkdown(source: string): Root {
  return processor.parse(source);
}

/** Line endings are normalized so that offsets and slices are stable. */
export function normalizeNewlines(source: string): string {
  return source.replace(/\r\n?/g, '\n');
}
