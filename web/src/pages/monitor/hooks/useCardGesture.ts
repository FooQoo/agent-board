import { useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';
import {
  LIFT_HOLD_MS,
  type RevealSide,
  cardOffset,
  cardSettles,
  revealOffset,
  swipeAxis,
  withinLiftTolerance,
} from '../model/lanes';

/** Where a pointer is, in the page's coordinates. */
export interface Point {
  x: number;
  y: number;
}

/** Keeps the pointer on `element` for the rest of the gesture. A pointer that is gone is not an error. */
export function capturePointer(element: Element, pointerId: number): void {
  try {
    element.setPointerCapture(pointerId);
  } catch {
    // The browser no longer has this pointer; the gesture ends on its own.
  }
}

type Phase = 'idle' | 'pending' | 'reveal' | 'lifted';

export interface CardGestureOptions {
  /** The side whose tiles are showing. The parent owns this, so it can close it from outside. */
  revealed: RevealSide | null;
  onRevealChange: (revealed: RevealSide | null) => void;
  /** The widths (px) of the tiles on each side; a side with none does not open. */
  leftWidth: number;
  rightWidth: number;
  /** The card was held for the lift delay; `grab` is where inside the card the finger took it. */
  onLiftStart: (point: Point, grab: Point, rect: DOMRect) => void;
  onLiftMove: (point: Point) => void;
  /** The finger was lifted, or the browser took the gesture (`cancelled`). */
  onLiftEnd: (point: Point, cancelled: boolean) => void;
  /** The card sits in the lane that is not on screen: it takes no gesture. */
  disabled?: boolean;
  /** False when a long press does not lift the card (the done lane keeps its order). */
  liftable?: boolean;
}

/** The sample the speed is read from: where the pointer was, and when. */
interface Sample extends Point {
  t: number;
}

/**
 * The gestures of one card. A press that moves sideways slides the card to show or hide the tiles
 * on that side. A press that holds still for 100 ms lifts the card, and the following moves carry it. A
 * press that moves up or down is left to the browser, which scrolls the lane. A sideways move
 * on empty space never reaches this: the lane swipe handles it.
 */
export function useCardGesture(
  ref: RefObject<HTMLElement | null>,
  {
    revealed,
    onRevealChange,
    leftWidth,
    rightWidth,
    onLiftStart,
    onLiftMove,
    onLiftEnd,
    disabled,
    liftable = true,
  }: CardGestureOptions,
) {
  const [drag, setDrag] = useState<number | null>(null);
  const [lifted, setLifted] = useState(false);
  const phase = useRef<Phase>('idle');
  const start = useRef<Sample>({ x: 0, y: 0, t: 0 });
  const last = useRef<Sample>({ x: 0, y: 0, t: 0 });
  const velocity = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const moved = useRef(false);
  const origin = useRef(0);

  const stop = () => {
    clearTimeout(timer.current);
    phase.current = 'idle';
    setDrag(null);
    setLifted(false);
  };
  useEffect(() => () => clearTimeout(timer.current), []);

  // Once the card is held, a touch that moves must not scroll the lane. React's touch handlers are
  // passive, so this one is added by hand.
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const block = (event: TouchEvent) => {
      if ((phase.current === 'lifted' || phase.current === 'reveal') && event.cancelable)
        event.preventDefault();
    };
    element.addEventListener('touchmove', block, { passive: false });
    return () => element.removeEventListener('touchmove', block);
  }, [ref]);

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (disabled || !event.isPrimary || event.button !== 0 || phase.current !== 'idle') return;
    if ((event.target as Element).closest('[data-swipe-action]')) return;
    const element = event.currentTarget;
    const now = event.timeStamp;
    start.current = { x: event.clientX, y: event.clientY, t: now };
    last.current = start.current;
    velocity.current = 0;
    moved.current = false;
    origin.current = revealOffset(revealed, leftWidth, rightWidth);
    phase.current = 'pending';
    timer.current = setTimeout(() => {
      if (phase.current !== 'pending') return;
      // A revealed card is closed by a tap, not lifted.
      if (revealed !== null || !liftable) return;
      phase.current = 'lifted';
      moved.current = true;
      capturePointer(element, event.pointerId);
      const rect = element.getBoundingClientRect();
      const point = { x: last.current.x, y: last.current.y };
      setLifted(true);
      onLiftStart(point, { x: point.x - rect.left, y: point.y - rect.top }, rect);
    }, LIFT_HOLD_MS);
  };

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const dx = event.clientX - start.current.x;
    const dy = event.clientY - start.current.y;
    const dt = event.timeStamp - last.current.t;
    if (dt > 0) velocity.current = (event.clientX - last.current.x) / dt;
    last.current = { x: event.clientX, y: event.clientY, t: event.timeStamp };
    if (phase.current === 'lifted') {
      onLiftMove({ x: event.clientX, y: event.clientY });
    } else if (phase.current === 'pending') {
      const axis = swipeAxis(dx, dy);
      if (axis === 'x') {
        clearTimeout(timer.current);
        phase.current = 'reveal';
        moved.current = true;
        capturePointer(event.currentTarget, event.pointerId);
        setDrag(cardOffset(origin.current, dx, leftWidth, rightWidth));
      } else if (axis === 'y' || !withinLiftTolerance(dx, dy)) {
        // A scroll: the browser takes it from here.
        clearTimeout(timer.current);
        phase.current = 'idle';
      }
    } else if (phase.current === 'reveal') {
      setDrag(cardOffset(origin.current, dx, leftWidth, rightWidth));
    }
  };

  const finish = (event: PointerEvent<HTMLElement>, cancelled: boolean) => {
    const was = phase.current;
    const point = { x: event.clientX, y: event.clientY };
    const offset = cardOffset(
      origin.current,
      event.clientX - start.current.x,
      leftWidth,
      rightWidth,
    );
    const speed = velocity.current;
    stop();
    if (was === 'lifted') onLiftEnd(point, cancelled);
    if (was === 'reveal' && !cancelled)
      onRevealChange(cardSettles(offset, speed, leftWidth, rightWidth));
  };

  return {
    /** The slide in px while a finger drags the card; null when it rests. */
    drag,
    lifted,
    /** True when the press was a gesture, so the click that follows is not a tap. */
    consumesClick: () => moved.current,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: (event: PointerEvent<HTMLElement>) => finish(event, false),
      onPointerCancel: (event: PointerEvent<HTMLElement>) => finish(event, true),
      onContextMenu: (event: { preventDefault: () => void }) => {
        if (phase.current !== 'idle') event.preventDefault();
      },
    },
  };
}
