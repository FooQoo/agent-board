import type { SyntheticEvent } from 'react';

const keepFocus = (event: SyntheticEvent) => event.preventDefault();

/**
 * Props for a submit button that sits next to a text field. Pressing a button normally moves focus
 * to it, so on a touch screen the field blurs, the software keyboard closes, and the layout shifts
 * before the tap's `click` arrives; the first tap then only closes the keyboard. Cancelling the
 * press keeps focus in the field, the layout stays put, and one tap sends. `click`, and so the
 * keyboard's Enter and Space, is not affected.
 */
export const keepFocusOnPress = {
  onPointerDown: keepFocus,
  onMouseDown: keepFocus,
} as const;
