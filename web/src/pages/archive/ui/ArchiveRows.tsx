import { useVirtualizer } from '@tanstack/react-virtual';
import { useLayoutEffect, useRef, useState } from 'react';
import type { ArchivedTask } from '../../../features/tasks/api/read';
import {
  observeRectWithFallback,
  useLoadMoreAtEnd,
} from '../../../features/tasks/model/useLoadMoreAtEnd';
import type { ArchivePages } from '../../../features/tasks/model/useArchivePages';
import { AssigneeLabel } from '../../../features/tasks/assignee/AssigneeLabel';
import { EpicBadge } from '../../../features/epics/label/EpicBadge';

/** A row (76px) and the 8px gap under it, before the row is measured. */
const ESTIMATED_ROW = 84;
const OVERSCAN = 6;

export interface ArchiveRowsProps {
  tasks: readonly ArchivedTask[];
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  pages: Pick<ArchivePages, 'hasMore' | 'loadingMore' | 'loadMoreFailed' | 'loadMore'>;
}

/**
 * The archive rows of the PC list, of which only those near the viewport are in the DOM. The pane
 * (`.list-pane`) scrolls; when the last row enters the rendered range the next page is asked for.
 */
export function ArchiveRows({ tasks, selectedId, onSelect, pages }: ArchiveRowsProps) {
  const box = useRef<HTMLDivElement>(null);
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);

  // The scrolling pane, and where the rows start inside it (the heading sits above them).
  useLayoutEffect(() => {
    const element = box.current;
    const pane = element?.closest<HTMLElement>('.list-pane') ?? null;
    setScroller((current) => (current === pane ? current : pane));
    if (element === null || pane === null) return;
    const top = Math.round(
      element.getBoundingClientRect().top - pane.getBoundingClientRect().top + pane.scrollTop,
    );
    setScrollMargin((current) => (Math.abs(current - top) < 1 ? current : top));
  });

  const virtualizer = useVirtualizer({
    count: tasks.length,
    getScrollElement: () => scroller,
    estimateSize: () => ESTIMATED_ROW,
    overscan: OVERSCAN,
    getItemKey: (index) => tasks[index]?.id ?? index,
    scrollMargin,
    observeElementRect: observeRectWithFallback,
  });
  const items = virtualizer.getVirtualItems();
  useLoadMoreAtEnd(items.at(-1)?.index, tasks.length, pages);

  return (
    <div ref={box} className="archive-rows" style={{ height: virtualizer.getTotalSize() }}>
      {items.map((item) => {
        const task = tasks[item.index] as ArchivedTask;
        return (
          <div
            className="archive-row"
            role="listitem"
            key={task.id}
            data-index={item.index}
            ref={virtualizer.measureElement}
            style={{ transform: `translateY(${item.start - scrollMargin}px)` }}
          >
            <button
              type="button"
              aria-pressed={selectedId === task.id}
              onClick={() => onSelect(selectedId === task.id ? null : task.id)}
            >
              <span className="archive-row__id">#{task.id}</span>
              <span className="archive-row__title" title={task.title}>
                {task.title}
              </span>
              <AssigneeLabel assignee={task.assignee} />
              <span className="archive-row__meta">
                <time
                  className="archive-row__date"
                  dateTime={task.archivedAt ?? undefined}
                  title={task.archivedAt ?? undefined}
                >
                  {task.archivedAt?.slice(0, 10) ?? '—'}
                </time>
                {task.epic && <EpicBadge epic={task.epic} className="archive-row__epic" />}
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
