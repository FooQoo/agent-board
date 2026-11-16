import { useEffect, useRef, useState, type RefObject } from 'react';
import type { MonitorTask } from '../contracts';
import type { MonitorSection } from '../components/MonitorSectionHeader';
import { AUTOSCROLL_ZONE, dropSlot, reorderBefore, reorderShifts } from '../model/lanes';
import type { Point } from './useCardGesture';

/** A card that is held up and carried up or down its lane. */
export interface Lift {
  item: MonitorTask;
  source: MonitorSection;
  /** The finger, relative to the lanes viewport, and where inside the card it took hold. */
  pointer: Point;
  grab: Point;
  /** The card's place and width when it was lifted, relative to the lanes viewport. */
  left: number;
  width: number;
  /** Where among the other cards it would land. */
  slot: number;
}

/** The lane as it was when the card was lifted, in the scroll content's coordinates. */
interface Layout {
  scroller: HTMLElement;
  ids: number[];
  tops: number[];
  heights: number[];
  /** The middles of the other cards, the lines a held card crosses to change places. */
  middles: number[];
}

function measure(scroller: HTMLElement, liftedId: number): Layout {
  const origin = scroller.getBoundingClientRect().top - scroller.scrollTop;
  const ids: number[] = [];
  const tops: number[] = [];
  const heights: number[] = [];
  const middles: number[] = [];
  for (const card of scroller.querySelectorAll<HTMLElement>('[data-swipe-card]')) {
    const id = Number(card.dataset.swipeCard);
    const rect = card.getBoundingClientRect();
    ids.push(id);
    tops.push(rect.top - origin);
    heights.push(rect.height);
    if (id !== liftedId) middles.push(rect.top - origin + rect.height / 2);
  }
  return { scroller, ids, tops, heights, middles };
}

/**
 * The long press that reorders a lane, as the PC board's drag does: the held card follows the
 * finger up and down, the other cards make room where it would land, and a lane that is longer than
 * the screen scrolls when the finger nears its top or bottom. Letting go calls `onReorder` with the
 * card it now comes before (null: the end), unless it landed where it was.
 */
export function useLaneReorder(
  viewport: RefObject<HTMLElement | null>,
  { onReorder }: { onReorder: (item: MonitorTask, beforeId: number | null) => void },
) {
  const [lift, setLift] = useState<Lift | null>(null);
  const layout = useRef<Layout | null>(null);
  const finger = useRef<Point>({ x: 0, y: 0 });
  const frame = useRef<number | undefined>(undefined);

  const viewportTop = () => viewport.current?.getBoundingClientRect().top ?? 0;
  const viewportLeft = () => viewport.current?.getBoundingClientRect().left ?? 0;

  /** The slot under the held card's middle, read against the current scroll position. */
  const slotAt = (current: Lift, point: Point) => {
    const plan = layout.current;
    if (!plan) return current.slot;
    const index = plan.ids.indexOf(current.item.task.id);
    const height = plan.heights[index] ?? 0;
    const origin = plan.scroller.getBoundingClientRect().top - plan.scroller.scrollTop;
    return dropSlot(plan.middles, point.y - current.grab.y + height / 2 - origin);
  };

  const follow = (point: Point) => {
    finger.current = point;
    setLift((current) =>
      current
        ? {
            ...current,
            pointer: { x: point.x - viewportLeft(), y: point.y - viewportTop() },
            slot: slotAt(current, point),
          }
        : current,
    );
  };

  const followLatest = useRef(follow);
  followLatest.current = follow;

  // While a card is held near the top or bottom of its lane, the lane scrolls under it.
  const lifted = lift !== null;
  useEffect(() => {
    if (!lifted) return;
    const step = () => {
      const scroller = layout.current?.scroller;
      if (scroller) {
        const rect = scroller.getBoundingClientRect();
        const y = finger.current.y;
        const speed =
          y < rect.top + AUTOSCROLL_ZONE
            ? -Math.ceil((rect.top + AUTOSCROLL_ZONE - y) / 6)
            : y > rect.bottom - AUTOSCROLL_ZONE
              ? Math.ceil((y - (rect.bottom - AUTOSCROLL_ZONE)) / 6)
              : 0;
        if (speed !== 0) {
          const before = scroller.scrollTop;
          scroller.scrollTop += speed;
          if (scroller.scrollTop !== before) followLatest.current(finger.current);
        }
      }
      frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
    return () => {
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    };
  }, [lifted]);

  const plan = layout.current;
  const shifts =
    lift && plan
      ? reorderShifts(plan.ids, plan.tops, plan.heights, lift.item.task.id, lift.slot)
      : null;

  return {
    lift,
    /** How far each card of the held card's lane moves to make room; null while nothing is held. */
    shifts,
    start: (
      item: MonitorTask,
      source: MonitorSection,
      card: HTMLElement,
      point: Point,
      grab: Point,
      rect: DOMRect,
    ) => {
      const scroller = card.closest<HTMLElement>('.monitor-lane__scroll');
      if (!scroller) return;
      layout.current = measure(scroller, item.task.id);
      finger.current = point;
      const index = layout.current.ids.indexOf(item.task.id);
      setLift({
        item,
        source,
        pointer: { x: point.x - viewportLeft(), y: point.y - viewportTop() },
        grab,
        left: rect.left - viewportLeft(),
        width: rect.width,
        slot: index,
      });
    },
    move: follow,
    end: (cancelled: boolean) => {
      const was = lift;
      const order = layout.current?.ids ?? [];
      setLift(null);
      layout.current = null;
      if (!was || cancelled) return;
      const before = reorderBefore(order, was.item.task.id, was.slot);
      if (before !== undefined) onReorder(was.item, before);
    },
  };
}
