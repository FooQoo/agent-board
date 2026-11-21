import { type RefObject, useRef, useState } from 'react';
import { useSideSwipe } from './useSideSwipe';
import { cardOffset, cardSettles, type RevealSide, revealOffset } from './cardReveal';

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
  /**
   * Whether a rightward swipe slides the card (default true). A screen whose sideways swipe also
   * switches tabs turns it off, so a swipe to the right on a card goes to the tabs. A card that
   * already shows its tiles still slides back to the right to close.
   */
  swipeRight?: boolean;
}

/**
 * The gestures of one card. Holding it chooses it (a focus ring shows); a chosen card slides
 * sideways to show the tiles on that side, and the same press that chose it can slide it. On any
 * other card a sideways move belongs to the lane carousel. The press itself is read by
 * `useSideSwipe`; this hook turns the distance into where the card rests.
 */
export function useCardGesture(
  ref: RefObject<HTMLElement | null>,
  {
    revealed,
    onRevealChange,
    armed,
    onArm,
    leftWidth,
    rightWidth,
    disabled,
    swipeRight = true,
  }: CardGestureOptions,
) {
  const [drag, setDrag] = useState<number | null>(null);
  const origin = useRef(0);
  const at = (dx: number) => cardOffset(origin.current, dx, leftWidth, rightWidth);
  const { consumesClick, handlers } = useSideSwipe(ref, {
    active: armed,
    onHold: onArm,
    disabled,
    accepts: (dx) => swipeRight || dx < 0 || revealed !== null,
    ignore: '[data-swipe-action]',
    onPress: () => {
      origin.current = revealOffset(revealed, leftWidth, rightWidth);
    },
    onSlide: (dx) => setDrag(at(dx)),
    onRelease: (dx, velocity, cancelled) => {
      setDrag(null);
      if (!cancelled) onRevealChange(cardSettles(at(dx), velocity, leftWidth, rightWidth));
    },
  });
  return {
    /** The slide in px while a finger drags the card; null when it rests. */
    drag,
    consumesClick,
    handlers,
  };
}
