import { useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';
import {
  ARM_HOLD_MS,
  type RevealSide,
  cardOffset,
  cardSettles,
  revealOffset,
  swipeAxis,
  withinArmTolerance,
} from '../model/lanes';

/** Keeps the pointer on `element` for the rest of the gesture. A pointer that is gone is not an error. */
export function capturePointer(element: Element, pointerId: number): void {
  try {
    element.setPointerCapture(pointerId);
  } catch {
    // The browser no longer has this pointer; the gesture ends on its own.
  }
}

/** `hold`: an unchosen card waits for the hold. `press`: a chosen card waits for a direction. */
type Phase = 'idle' | 'hold' | 'press' | 'reveal';

export interface CardGestureOptions {
  /** The side whose tiles are showing. The parent owns this, so it can close it from outside. */
  revealed: RevealSide | null;
  onRevealChange: (revealed: RevealSide | null) => void;
  /** The card is chosen (it shows a focus ring): only then does a sideways swipe slide it. */
  armed: boolean;
  /** The card was held long enough to be chosen. */
  onArm: () => void;
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
 * The gestures of one card. One rule decides a sideways move: on a chosen card it slides the card
 * to show the tiles on that side, and on any other card it is the lane swipe's. Holding a card
 * chooses it (a focus ring shows), and the same press can then swipe it. An up or down move scrolls.
 */
export function useCardGesture(
  ref: RefObject<HTMLElement | null>,
  { revealed, onRevealChange, armed, onArm, leftWidth, rightWidth, disabled }: CardGestureOptions,
) {
  const [drag, setDrag] = useState<number | null>(null);
  const phase = useRef<Phase>('idle');
  const start = useRef({ x: 0, y: 0 });
  const last = useRef<Sample>({ x: 0, t: 0 });
  const velocity = useRef(0);
  const moved = useRef(false);
  const origin = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

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
    start.current = { x: event.clientX, y: event.clientY };
    last.current = { x: event.clientX, t: event.timeStamp };
    velocity.current = 0;
    moved.current = false;
    origin.current = revealOffset(revealed, leftWidth, rightWidth);
    if (armed) {
      phase.current = 'press';
      return;
    }
    phase.current = 'hold';
    timer.current = setTimeout(() => {
      if (phase.current !== 'hold') return;
      // Chosen: from here the same press can swipe it, like a press on a chosen card.
      phase.current = 'press';
      // The click that ends the hold is not a tap on the card.
      moved.current = true;
      onArm();
    }, ARM_HOLD_MS);
  };

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const dx = event.clientX - start.current.x;
    const dy = event.clientY - start.current.y;
    const dt = event.timeStamp - last.current.t;
    if (dt > 0) velocity.current = (event.clientX - last.current.x) / dt;
    last.current = { x: event.clientX, t: event.timeStamp };
    if (phase.current === 'hold') {
      // Moved before the hold: the lane swipe or the browser's scroll takes it.
      if (!withinArmTolerance(dx, dy)) {
        clearTimeout(timer.current);
        phase.current = 'idle';
      }
    } else if (phase.current === 'press') {
      const axis = swipeAxis(dx, dy);
      if (axis === 'y') phase.current = 'idle';
      if (axis !== 'x') return;
      phase.current = 'reveal';
      moved.current = true;
      capturePointer(event.currentTarget, event.pointerId);
      setDrag(cardOffset(origin.current, dx, leftWidth, rightWidth));
    } else if (phase.current === 'reveal') {
      setDrag(cardOffset(origin.current, dx, leftWidth, rightWidth));
    }
  };

  const finish = (event: PointerEvent<HTMLElement>, cancelled: boolean) => {
    clearTimeout(timer.current);
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
    /** True when the press was a hold or a swipe, so the click that follows is not a tap. */
    consumesClick: () => moved.current,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: (event: PointerEvent<HTMLElement>) => finish(event, false),
      onPointerCancel: (event: PointerEvent<HTMLElement>) => finish(event, true),
      // A long press must not open the browser's menu for the card.
      onContextMenu: (event: { preventDefault: () => void }) => event.preventDefault(),
    },
  };
}
