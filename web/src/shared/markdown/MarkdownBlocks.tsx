import { Suspense, useMemo } from 'react';
import { preloadable } from '../lib/lazy/preloadable';
import { MarkdownBlock } from './MarkdownBlock';
import { blockKey, shouldVirtualize, type MarkdownBlockData } from './model/blocks';
import { RenderScopeContext, ResolverContext } from './renderScope';
import type { AttachmentResolver } from './model';
import './markdown.css';

export type MarkdownVariant = 'compact' | 'wide';

export interface MarkdownBlocksProps {
  blocks: readonly MarkdownBlockData[];
  /**
   * The element that scrolls the document. A large document is virtualized only when this is given; `null`
   * means the element is not attached yet. Leave it out to draw every block.
   */
  scrollParent?: HTMLElement | null;
  /** True while blocks are still arriving: the last block may be incomplete, so a diagram there waits. */
  isStreaming?: boolean;
  variant?: MarkdownVariant;
  resolveAttachment?: AttachmentResolver;
}

/** The virtual list (and `@tanstack/react-virtual` with it) loads only when a large document needs it. */
const virtual = preloadable(() =>
  import('./VirtualMarkdown').then((module) => module.VirtualMarkdown),
);

/** Fetches the virtual list; a failed fetch is tried again when a large document is first shown. */
export function preloadVirtualMarkdown(): Promise<unknown> {
  return virtual.preload();
}

/**
 * A document as an array of blocks, drawn as the `MarkdownView` draws a text. A document of 5,000
 * characters or 40 blocks or more is virtualized: only the blocks near the viewport are mounted. A
 * smaller one, or any document without a scroll parent, is drawn whole.
 */
export function MarkdownBlocks({
  blocks,
  scrollParent,
  isStreaming = false,
  variant = 'compact',
  resolveAttachment,
}: MarkdownBlocksProps) {
  const large = scrollParent !== undefined && shouldVirtualize(blocks);
  const scope = useMemo(
    () => ({ scrollParent: scrollParent ?? null, deferMermaid: false, complete: true }),
    [scrollParent],
  );

  if (large) {
    return (
      <ResolverContext.Provider value={resolveAttachment}>
        <RenderScopeContext.Provider value={scope}>
          <Suspense fallback={<div className={`md md--${variant}`} aria-busy="true" />}>
            {scrollParent === null ? (
              <div className={`md md--${variant}`} aria-busy="true" />
            ) : (
              <virtual.Component
                blocks={blocks}
                scrollParent={scrollParent}
                isStreaming={isStreaming}
                variant={variant}
              />
            )}
          </Suspense>
        </RenderScopeContext.Provider>
      </ResolverContext.Provider>
    );
  }

  const last = blocks.length - 1;
  return (
    <ResolverContext.Provider value={resolveAttachment}>
      <RenderScopeContext.Provider value={scope}>
        <div className={`md md--${variant}`} aria-busy={isStreaming || undefined}>
          {blocks.map((block, index) => (
            <MarkdownBlock
              key={blockKey(block)}
              block={block}
              waiting={isStreaming && index === last}
            />
          ))}
        </div>
      </RenderScopeContext.Provider>
    </ResolverContext.Provider>
  );
}
