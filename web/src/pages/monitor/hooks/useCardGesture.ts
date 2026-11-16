import { useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';
import {
  type RevealSide,
  atScreenEdge,
  cardOffset,
  cardSettles,
  revealOffset,
  swipeAxis,
} from '../model/lanes';

/** Keeps the pointer on `element` for the rest of the gesture. A pointer that is gone is not an error. */
export function capturePointer(element: Element, pointerId: number): void {
  try {
    element.setPointerCapture(pointerId);
  } catch {
    // The browser no longer has this pointer; the gesture ends on its own.
  }
}

type Phase = 'idle' | 'pending' | 'reveal';

export interface CardGestureOptions {
  /** The side whose tiles are showing. The parent owns this, so it can close it from outside. */
  revealed: RevealSide | null;
  onRevealChange: (revealed: RevealSide | null) => void;
  /** The widths (px) of the tiles on each side; a side with none does not open. */
  leftWidth: number;
  rightWidth: number;
  /** The card sits in the lane that is not on screen: it takes no gesture. */
  disabled?: boolean;
}

/** The sample the speed is read from: where the pointer was, and when. */
interface Sample {
  x: number;
  t: number;
}

/**
 * The swipe of one card. A press that moves sideways slides the card to show or hide the tiles on
 * that side. A press that moves up or down is left to the browser, which scrolls the lane. A
 * sideways move on empty space, or one that starts at the edge of the screen, never reaches this:
 * the lane swipe handles it.
 */
export function useCardGesture(
  ref: RefObject<HTMLElement | null>,
  { revealed, onRevealChange, leftWidth, rightWidth, disabled }: CardGestureOptions,
) {
  const [drag, setDrag] = useState<number | null>(null);
  const phase = useRef<Phase>('idle');
  const start = useRef({ x: 0, y: 0 });
  const last = useRef<Sample>({ x: 0, t: 0 });
  const velocity = useRef(0);
  const moved = useRef(false);
  const origin = useRef(0);

  // Once the card slides, a touch that moves must not scroll the lane. React's touch handlers are
  // passive, so this one is added by hand.
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const block = (event: TouchEvent) => {
      if (phase.current === 'reveal' && event.cancelable) event.preventDefault();
    };
    element.addEventListener('touchmove', block, { passive: false });
    return () => element.removeEventListener('touchmove', block);
  }, [ref]);

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (disabled || !event.isPrimary || event.button !== 0 || phase.current !== 'idle') return;
    if ((event.target as Element).closest('[data-swipe-action]')) return;
    // A press at the edge of the screen belongs to the lane swipe.
    if (atScreenEdge(event.clientX, window.innerWidth)) return;
    start.current = { x: event.clientX, y: event.clientY };
    last.current = { x: event.clientX, t: event.timeStamp };
    velocity.current = 0;
    moved.current = false;
    origin.current = revealOffset(revealed, leftWidth, rightWidth);
    phase.current = 'pending';
  };

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    if (phase.current === 'idle') return;
    const dx = event.clientX - start.current.x;
    const dt = event.timeStamp - last.current.t;
    if (dt > 0) velocity.current = (event.clientX - last.current.x) / dt;
    last.current = { x: event.clientX, t: event.timeStamp };
    if (phase.current === 'pending') {
      const axis = swipeAxis(dx, event.clientY - start.current.y);
      if (axis === 'y') phase.current = 'idle';
      if (axis !== 'x') return;
      phase.current = 'reveal';
      moved.current = true;
      capturePointer(event.currentTarget, event.pointerId);
    }
    setDrag(cardOffset(origin.current, dx, leftWidth, rightWidth));
  };

  const finish = (event: PointerEvent<HTMLElement>, cancelled: boolean) => {
    const was = phase.current;
    const offset = cardOffset(
      origin.current,
      event.clientX - start.current.x,
      leftWidth,
      rightWidth,
    );
    phase.current = 'idle';
    setDrag(null);
    if (was === 'reveal' && !cancelled)
      onRevealChange(cardSettles(offset, velocity.current, leftWidth, rightWidth));
  };

  return {
    /** The slide in px while a finger drags the card; null when it rests. */
    drag,
    /** True when the press was a swipe, so the click that follows is not a tap. */
    consumesClick: () => moved.current,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: (event: PointerEvent<HTMLElement>) => finish(event, false),
      onPointerCancel: (event: PointerEvent<HTMLElement>) => finish(event, true),
    },
  };
}
