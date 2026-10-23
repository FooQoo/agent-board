import { defaultRangeExtractor, useVirtualizer, type Range } from '@tanstack/react-virtual';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MarkdownBlock } from './MarkdownBlock';
import { blockKey, estimateBlockSize, type MarkdownBlockData } from './model/blocks';
import './markdown.css';

const OVERSCAN = 4;

/** The ids of the blocks that hold the focus or an end of the text selection. */
function blockIdsOf(root: HTMLElement, nodes: Array<Node | null>): string[] {
  const ids = new Set<string>();
  for (const node of nodes) {
    if (node === null || !root.contains(node)) continue;
    const element = node instanceof Element ? node : node.parentElement;
    const id = element?.closest<HTMLElement>('[data-block-id]')?.dataset.blockId;
    if (id !== undefined) ids.add(id);
  }
  return [...ids];
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

/**
 * The blocks of a large document, of which only those near the viewport are mounted. Each row is measured
 * once it is shown (so a picture or a diagram that changes its height changes the row's height), and the
 * scroll position is corrected when a row above the viewport changes. A block with the focus or a part of
 * the selection stays mounted when it is scrolled out of view.
 */
export function VirtualMarkdown({
  blocks,
  scrollParent,
  isStreaming,
  variant,
}: {
  blocks: readonly MarkdownBlockData[];
  scrollParent: HTMLElement;
  isStreaming: boolean;
  variant: 'compact' | 'wide';
}) {
  const box = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  const [pinned, setPinned] = useState<string[]>([]);
  const idsRef = useRef<string[]>([]);
  idsRef.current = blocks.map((block) => block.id);

  // Where the document starts inside the scrolling element: a title and tabs may sit above it.
  useLayoutEffect(() => {
    const element = box.current;
    if (element === null) return;
    const measure = () => {
      const top =
        element.getBoundingClientRect().top -
        scrollParent.getBoundingClientRect().top +
        scrollParent.scrollTop;
      setScrollMargin((current) => (Math.abs(current - top) < 1 ? current : Math.round(top)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scrollParent);
    return () => observer.disconnect();
  }, [scrollParent]);

  // The focus and the selection decide which blocks stay mounted outside the visible range.
  useEffect(() => {
    const element = box.current;
    if (element === null) return;
    const update = () => {
      const selection = document.getSelection();
      const ids = blockIdsOf(element, [
        document.activeElement,
        ...(selection !== null && !selection.isCollapsed
          ? [selection.anchorNode, selection.focusNode]
          : []),
      ]);
      setPinned((current) => (sameIds(current, ids) ? current : ids));
    };
    document.addEventListener('selectionchange', update);
    element.addEventListener('focusin', update);
    element.addEventListener('focusout', update);
    return () => {
      document.removeEventListener('selectionchange', update);
      element.removeEventListener('focusin', update);
      element.removeEventListener('focusout', update);
    };
  }, []);

  const rangeExtractor = useCallback(
    (range: Range) => {
      const shown = defaultRangeExtractor(range);
      if (pinned.length === 0) return shown;
      const all = new Set(shown);
      for (const id of pinned) {
        const index = idsRef.current.indexOf(id);
        if (index >= 0) all.add(index);
      }
      return [...all].sort((a, b) => a - b);
    },
    [pinned],
  );

  const virtualizer = useVirtualizer({
    count: blocks.length,
    getScrollElement: () => scrollParent,
    estimateSize: (index) => estimateBlockSize(blocks[index] as MarkdownBlockData),
    overscan: OVERSCAN,
    getItemKey: (index) => blocks[index]?.id ?? index,
    scrollMargin,
    rangeExtractor,
  });

  const last = blocks.length - 1;
  return (
    <div
      ref={box}
      className={`md md--${variant} md-virtual`}
      data-virtual-list=""
      aria-busy={isStreaming || undefined}
      style={{ height: virtualizer.getTotalSize(), position: 'relative' }}
    >
      {virtualizer.getVirtualItems().map((item) => {
        const block = blocks[item.index] as MarkdownBlockData;
        return (
          <div
            key={blockKey(block)}
            ref={virtualizer.measureElement}
            data-index={item.index}
            data-block-id={block.id}
            className="md-vblock"
            style={{ transform: `translateY(${item.start - scrollMargin}px)` }}
          >
            <MarkdownBlock block={block} waiting={isStreaming && item.index === last} />
          </div>
        );
      })}
    </div>
  );
}
