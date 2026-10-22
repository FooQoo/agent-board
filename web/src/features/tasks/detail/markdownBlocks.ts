import type { DetailBlock } from '../../../shared/data/core';
import type { MarkdownBlockData } from '../../../shared/markdown/model/blocks';

/** The blocks of a Detail as the Markdown renderer takes them. */
export function markdownBlocksOf(blocks: readonly DetailBlock[]): MarkdownBlockData[] {
  return blocks.map((block, index) => ({
    id: String(index),
    kind: block.kind,
    source: block.text,
    ...(block.images ? { images: block.images } : {}),
  }));
}
