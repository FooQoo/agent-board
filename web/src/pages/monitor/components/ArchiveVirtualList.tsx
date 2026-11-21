import { useVirtualizer } from '@tanstack/react-virtual';
import { useLayoutEffect, useRef, useState } from 'react';
import type { ArchivedTask } from '../../../features/tasks/api/read';
import type { ProjectId } from '../../../shared/api/contracts';
import {
  observeRectWithFallback,
  useLoadMoreAtEnd,
} from '../../../features/tasks/model/useLoadMoreAtEnd';
import type { ArchivePages } from '../../../features/tasks/model/useArchivePages';
import { ArchiveSwipeRow } from './ArchiveSwipeRow';

/** A row's height before it is measured: a lane card plus the line under it, and the 10px gap. */
const ESTIMATED_ROW = 150;
const OVERSCAN = 4;

export interface ArchiveVirtualListProps {
  tasks: readonly ArchivedTask[];
  projectId: ProjectId;
  projectName: string;
  label: string;
  /** The element with `overflow-y: auto` that the rows scroll in (the sheet's body). */
  scrollElement: HTMLElement | null;
  revealed: number | null;
  busy: number | null;
  onRevealChange: (id: number, revealed: boolean) => void;
  onRestore: (id: number) => void;
  /** The next page: asked for when the last row is in the rendered range. */
  pages: Pick<ArchivePages, 'hasMore' | 'loadingMore' | 'loadMoreFailed' | 'loadMore'>;
}

/**
 * The archive rows, of which only those near the viewport are in the DOM. Each row is measured once
 * shown. A revealed row that is scrolled out of view unmounts; its Restore tile stays open by id, so
 * it is open again when the row scrolls back (a tap elsewhere closes it, as for any open row).
 */
export function ArchiveVirtualList({
  tasks,
  projectId,
  projectName,
  label,
  scrollElement,
  revealed,
  busy,
  onRevealChange,
  onRestore,
  pages,
}: ArchiveVirtualListProps) {
  const box = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);

  // Where the list starts inside the scrolling element: the hint and an error sit above it.
  useLayoutEffect(() => {
    const element = box.current;
    if (element === null || scrollElement === null) return;
    const top = Math.round(
      element.getBoundingClientRect().top -
        scrollElement.getBoundingClientRect().top +
        scrollElement.scrollTop,
    );
    setScrollMargin((current) => (Math.abs(current - top) < 1 ? current : top));
  });

  const virtualizer = useVirtualizer({
    count: tasks.length,
    getScrollElement: () => scrollElement,
    estimateSize: () => ESTIMATED_ROW,
    overscan: OVERSCAN,
    getItemKey: (index) => tasks[index]?.id ?? index,
    scrollMargin,
    observeElementRect: observeRectWithFallback,
  });
  const items = virtualizer.getVirtualItems();
  useLoadMoreAtEnd(items.at(-1)?.index, tasks.length, pages);

  return (
    <div
      ref={box}
      className="archive-sheet__list archive-sheet__list--virtual"
      role="list"
      aria-label={label}
      style={{ height: virtualizer.getTotalSize() }}
    >
      {items.map((item) => {
        const task = tasks[item.index] as ArchivedTask;
        return (
          <ArchiveSwipeRow
            key={task.id}
            task={task}
            projectId={projectId}
            projectName={projectName}
            revealed={revealed === task.id}
            busy={busy === task.id}
            onRevealChange={onRevealChange}
            onRestore={onRestore}
            virtual={{
              index: item.index,
              count: tasks.length,
              start: item.start - scrollMargin,
              measureRef: virtualizer.measureElement,
            }}
          />
        );
      })}
    </div>
  );
}
