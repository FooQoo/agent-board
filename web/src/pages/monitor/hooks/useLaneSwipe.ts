import { useRef, useState, type PointerEvent, type RefObject } from 'react';
import type { MonitorSection } from '../components/MonitorSectionHeader';
import { capturePointer } from './useCardGesture';
import { SWIPE_SLOP, settleLane, swipeAxis, trackOffset } from '../model/lanes';

/**
 * The sideways swipe on empty space that moves to the neighbouring lane. The track follows the
 * finger, gives at the ends of the row, and settles with a slide. A press that lands on a card is
 * left to the card, which has its own sideways gestures.
 */
export function useLaneSwipe(
  ref: RefObject<HTMLElement | null>,
  {
    lane,
    onLaneChange,
    disabled,
  }: {
    lane: MonitorSection;
    onLaneChange: (lane: MonitorSection) => void;
    disabled?: boolean;
  },
) {
  // The track's offset in px while a finger drags it; null when it rests (the slide runs then).
  const [offset, setOffset] = useState<number | null>(null);
  const press = useRef<{ x: number; y: number; t: number; id: number; width: number } | null>(null);
  const swiping = useRef(false);
  const speed = useRef(0);
  const last = useRef({ x: 0, t: 0 });

  const end = (event: PointerEvent<HTMLElement>, cancelled: boolean) => {
    const was = press.current;
    press.current = null;
    if (!was || !swiping.current) return;
    swiping.current = false;
    setOffset(null);
    if (cancelled) return;
    const next = settleLane(lane, event.clientX - was.x, speed.current, was.width);
    if (next !== lane) onLaneChange(next);
  };

  return {
    offset,
    dragging: offset !== null,
    handlers: {
      onPointerDown: (event: PointerEvent<HTMLElement>) => {
        if (disabled || !event.isPrimary || event.button !== 0) return;
        const target = event.target as Element;
        if (target.closest('[data-swipe-card],button,a,[data-lane-ignore]')) return;
        const width = ref.current?.clientWidth ?? event.currentTarget.clientWidth;
        press.current = {
          x: event.clientX,
          y: event.clientY,
          t: event.timeStamp,
          id: event.pointerId,
          width,
        };
        last.current = { x: event.clientX, t: event.timeStamp };
        speed.current = 0;
      },
      onPointerMove: (event: PointerEvent<HTMLElement>) => {
        const was = press.current;
        if (!was) return;
        const dx = event.clientX - was.x;
        const dt = event.timeStamp - last.current.t;
        if (dt > 0) speed.current = (event.clientX - last.current.x) / dt;
        last.current = { x: event.clientX, t: event.timeStamp };
        if (!swiping.current) {
          const axis = swipeAxis(dx, event.clientY - was.y, SWIPE_SLOP);
          if (axis === null) return;
          if (axis === 'y') {
            press.current = null;
            return;
          }
          swiping.current = true;
          capturePointer(event.currentTarget, was.id);
        }
        setOffset(trackOffset(lane, dx, was.width));
      },
      onPointerUp: (event: PointerEvent<HTMLElement>) => end(event, false),
      onPointerCancel: (event: PointerEvent<HTMLElement>) => end(event, true),
    },
  };
}
