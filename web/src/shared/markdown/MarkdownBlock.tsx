import { memo, useContext, useMemo } from 'react';
import { MarkdownContent } from './MarkdownContent';
import { MermaidDiagram } from './MermaidDiagram';
import { mermaidSourceOfBlock, type MarkdownBlockData } from './model/blocks';
import { ImageSizesContext, RenderScopeContext, type ImageSizes } from './renderScope';

function imageSizesOf(images: MarkdownBlockData['images']): ImageSizes | undefined {
  if (images === undefined || images.length === 0) return undefined;
  const sizes = new Map<string, { width: number; height: number }>();
  for (const image of images) {
    if (
      image.width !== undefined &&
      image.height !== undefined &&
      image.width > 0 &&
      image.height > 0
    )
      sizes.set(image.src, { width: image.width, height: image.height });
  }
  return sizes.size === 0 ? undefined : sizes;
}

function sameImages(a: MarkdownBlockData['images'], b: MarkdownBlockData['images']): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined || a.length !== b.length) return false;
  return a.every((image, index) => {
    const other = b[index];
    return (
      other !== undefined &&
      image.src === other.src &&
      image.width === other.width &&
      image.height === other.height
    );
  });
}

/**
 * One block: Markdown text, or a diagram when the block's kind is `mermaid`. A diagram block takes its
 * text from between the fence lines the server sends, and draws only when it is near the viewport and,
 * while the document is still arriving, not the last block (`waiting`). It renders as a fragment, so
 * its elements are children of the `.md` box like the elements of a whole document.
 */
export const MarkdownBlock = memo(
  function MarkdownBlock({ block, waiting }: { block: MarkdownBlockData; waiting: boolean }) {
    const sizes = useMemo(() => imageSizesOf(block.images), [block.images]);
    const base = useContext(RenderScopeContext);
    const scope = useMemo(
      () => ({ scrollParent: base.scrollParent, deferMermaid: true, complete: !waiting }),
      [base.scrollParent, waiting],
    );
    if (block.kind === 'mermaid') {
      return (
        <RenderScopeContext.Provider value={scope}>
          <MermaidDiagram source={mermaidSourceOfBlock(block)} />
        </RenderScopeContext.Provider>
      );
    }
    return (
      <ImageSizesContext.Provider value={sizes}>
        <MarkdownContent source={block.source} />
      </ImageSizesContext.Provider>
    );
  },
  (previous, next) =>
    previous.waiting === next.waiting &&
    previous.block.id === next.block.id &&
    previous.block.kind === next.block.kind &&
    previous.block.source === next.block.source &&
    sameImages(previous.block.images, next.block.images),
);
