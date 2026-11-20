import type { RefObject } from 'react';

/** An image as written in the text: its `src` and alt text, before any URL is resolved. */
export interface WrittenImage {
  src: string;
  alt: string;
}

interface ImageTreeNode {
  type: string;
  url?: string;
  alt?: string | null;
  data?: { hProperties?: Record<string, unknown> };
  children?: ImageTreeNode[];
}

/**
 * A remark plugin that lists the images of one text in reading order into `collected`, and numbers
 * each one (`data-image-index`), so an image can open the enlarged view at its own place among the
 * others. The list is rebuilt each time the text is parsed.
 */
export function collectImages(collected: RefObject<WrittenImage[]>) {
  return () => (tree: ImageTreeNode) => {
    const list = collected.current;
    list.length = 0;
    const walk = (node: ImageTreeNode) => {
      if (node.type === 'image') {
        node.data = {
          ...node.data,
          hProperties: { ...node.data?.hProperties, dataImageIndex: list.length },
        };
        list.push({ src: node.url ?? '', alt: node.alt ?? '' });
      }
      for (const child of node.children ?? []) walk(child);
    };
    walk(tree);
  };
}
