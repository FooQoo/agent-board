import { useDrag } from '@use-gesture/react';
import { useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';
import {
  ARM_HOLD_MS,
  type RevealSide,
  SWIPE_SLOP,
  cardOffset,
  cardSettles,
  revealOffset,
  withinArmTolerance,
} from '../model/lanes';

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

/**
 * The gestures of one card. One rule decides a sideways move: on a chosen card it slides the card
 * to show the tiles on that side, and on any other card it belongs to the lane carousel. Holding a
 * card chooses it (a focus ring shows), and the same press can then swipe it. An up or down move
 * scrolls. The drag itself is read by `@use-gesture/react`; this hook adds the hold.
 */
export function useCardGesture(
  ref: RefObject<HTMLElement | null>,
  { revealed, onRevealChange, armed, onArm, leftWidth, rightWidth, disabled }: CardGestureOptions,
) {
  const [drag, setDrag] = useState<number | null>(null);
  // Read from listeners that outlive a render: a hold chooses the card in the middle of a press.
  const chosen = useRef(armed);
  useEffect(() => {
    chosen.current = armed;
  }, [armed]);
  const sliding = useRef(false);
  const moved = useRef(false);
  const press = useRef<{ x: number; y: number; origin: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  // Once a card is chosen its moves are its own: the lane carousel (which listens above, on touch
  // and mouse events) does not see them, and a sliding card does not scroll the lane.
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const touch = (event: TouchEvent) => {
      if (!chosen.current) return;
      event.stopPropagation();
      if (sliding.current && event.cancelable) event.preventDefault();
    };
    const mouse = (event: MouseEvent) => {
      if (chosen.current) event.stopPropagation();
    };
    element.addEventListener('touchmove', touch, { passive: false });
    element.addEventListener('mousemove', mouse);
    return () => {
      element.removeEventListener('touchmove', touch);
      element.removeEventListener('mousemove', mouse);
    };
  }, [ref]);

  const bind = useDrag(
    ({ first, last, tap, movement: [mx], velocity: [vx], direction: [dx], cancel }) => {
      // A tap is the card's own: it opens the details or closes the tiles.
      if (tap) return;
      const origin = press.current?.origin ?? 0;
      if (first) {
        // A card that is not chosen leaves the sideways move to the lanes.
        if (!chosen.current) return cancel();
        sliding.current = true;
        moved.current = true;
      }
      if (!sliding.current) return;
      const offset = cardOffset(origin, mx, leftWidth, rightWidth);
      if (!last) {
        setDrag(offset);
        return;
      }
      sliding.current = false;
      setDrag(null);
      onRevealChange(cardSettles(offset, vx * dx, leftWidth, rightWidth));
    },
    {
      axis: 'x',
      threshold: SWIPE_SLOP,
      filterTaps: true,
      enabled: !disabled,
      // A touch stays with the card it began on anyway; the window hears the rest of a mouse drag.
      pointer: { capture: false },
    },
  );
  const drags = bind();

  const endHold = () => clearTimeout(timer.current);

  return {
    /** The slide in px while a finger drags the card; null when it rests. */
    drag,
    /** True when the press was a hold or a swipe, so the click that follows is not a tap. */
    consumesClick: () => moved.current,
    handlers: {
      ...drags,
      onPointerDown: (event: PointerEvent<HTMLElement>) => {
        if (disabled || !event.isPrimary || event.button !== 0) return;
        if ((event.target as Element).closest('[data-swipe-action]')) return;
        press.current = {
          x: event.clientX,
          y: event.clientY,
          origin: revealOffset(revealed, leftWidth, rightWidth),
        };
        moved.current = false;
        drags.onPointerDown?.(event);
        if (armed) return;
        timer.current = setTimeout(() => {
          // Chosen: from here the same press can swipe it. The click that ends the hold is not a tap.
          chosen.current = true;
          moved.current = true;
          onArm();
        }, ARM_HOLD_MS);
      },
      onPointerMove: (event: PointerEvent<HTMLElement>) => {
        // Moved before the hold: the lane carousel or the browser's scroll takes the press.
        const at = press.current;
        if (at && !withinArmTolerance(event.clientX - at.x, event.clientY - at.y)) endHold();
        drags.onPointerMove?.(event);
      },
      onPointerUp: (event: PointerEvent<HTMLElement>) => {
        endHold();
        drags.onPointerUp?.(event);
      },
      onPointerCancel: (event: PointerEvent<HTMLElement>) => {
        endHold();
        sliding.current = false;
        setDrag(null);
        drags.onPointerCancel?.(event);
      },
      // A long press must not open the browser's menu for the card.
      onContextMenu: (event: { preventDefault: () => void }) => event.preventDefault(),
    },
  };
}
