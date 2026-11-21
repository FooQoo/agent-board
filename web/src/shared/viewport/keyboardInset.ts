import { editingText, revealFocusedField } from './stableHeight';

/**
 * How much of the layout viewport the on-screen keyboard covers at the bottom, in pixels. iOS Safari
 * keeps the layout viewport at full height and only shrinks the visual viewport, so a bottom sheet
 * with a fixed `bottom: 0` ends up behind the keyboard; lifting it by this amount keeps its toolbar
 * above the keyboard. A browser that resizes the layout viewport itself reports 0.
 */
export function keyboardInset(
  layoutHeight: number,
  visual: { height: number; offsetTop: number },
): number {
  return Math.max(0, Math.round(layoutHeight - visual.height - visual.offsetTop));
}

/** The smallest shrink of the visual viewport that counts as a keyboard when the page is panned. */
const MIN_PANNED_KEYBOARD_PX = 120;

/**
 * Whether the keyboard is open, given the layout height and the visual viewport. Normally that is a
 * visual viewport whose bottom stands above the layout viewport's bottom (`keyboardInset` > 0). When
 * iOS Safari pans the page up to a field low in a sheet, such as the answer note, the visual viewport
 * ends at the layout bottom again and the inset reads 0 although the keyboard is still up; its height
 * is then still short of the layout height by the keyboard's. A pinch zoom also shrinks the visual
 * viewport, so a zoomed page (scale above 1) does not count.
 */
export function keyboardOpen(
  layoutHeight: number,
  visual: { height: number; offsetTop: number; scale?: number },
): boolean {
  if (keyboardInset(layoutHeight, visual) > 0) return true;
  const zoomed = (visual.scale ?? 1) > 1.01;
  return !zoomed && layoutHeight - visual.height >= MIN_PANNED_KEYBOARD_PX;
}

/** Whether the primary input is a finger, so a focused text field means an on-screen keyboard. */
function touchScreen(target: Window): boolean {
  return target.matchMedia?.('(pointer: coarse)').matches ?? false;
}

/**
 * Keeps `--keyboard-inset`, `--visual-vh` and `--visual-top` on the root up to date from the visual
 * viewport, for as long as it runs (the app starts it once), and marks the root with `data-text-focus` while a text field has the focus on a touch screen, and with `data-visual-keyboard`
 * while the keyboard covers the page. The keyboard is only open while a text field has the focus, so
 * a visual viewport that is smaller for another reason (a pinch zoom, the browser's toolbar) does not
 * mark the root and does not move centered dialogs to the top. A sheet that must stay above the keyboard reads them in CSS:
 * `--visual-top` is where the visible area starts in the layout viewport, which iOS Safari moves
 * when it scrolls the page to a focused field.
 */
export function watchKeyboardInset(target: Window = window): () => void {
  const viewport = target.visualViewport;
  if (!viewport) return () => {};
  const root = target.document.documentElement;
  // The bar's strip is part of every sheet's height. Pressing a button blurs the field and would give
  // that strip back between the press and the release, moving the button from under the finger, so a
  // field losing the focus keeps the mark until the press ends.
  let pressed = false;
  const update = () => {
    root.style.setProperty('--keyboard-inset', `${keyboardInset(root.clientHeight, viewport)}px`);
    root.style.setProperty('--visual-vh', `${Math.round(viewport.height)}px`);
    root.style.setProperty('--visual-top', `${Math.round(viewport.offsetTop)}px`);
    const was = root.hasAttribute('data-visual-keyboard');
    const now = root.toggleAttribute(
      'data-visual-keyboard',
      keyboardOpen(root.clientHeight, viewport) && editingText(target.document.activeElement),
    );
    if (now && !was) revealFocusedField(target);
    // A touch device shows a keyboard for any text field, whatever its viewport did: iOS may resize
    // the layout viewport too, so no height gap shows. The phone bar goes on the focus alone.
    const focused = touchScreen(target) && editingText(target.document.activeElement);
    if (focused || !pressed) root.toggleAttribute('data-text-focus', focused);
  };
  const press = () => {
    pressed = true;
  };
  const release = () => {
    pressed = false;
    // The click follows the release; let it land before the layout moves.
    target.setTimeout(update, 0);
  };
  update();
  viewport.addEventListener('resize', update);
  viewport.addEventListener('scroll', update);
  // iOS scrolls the page itself when a field gets the focus; follow that as well.
  target.addEventListener('scroll', update);
  // The keyboard follows the focus; a field losing it must give the dialogs their place back.
  target.document.addEventListener('focusin', update);
  target.document.addEventListener('focusout', update);
  target.document.addEventListener('pointerdown', press, true);
  target.document.addEventListener('pointerup', release, true);
  target.document.addEventListener('pointercancel', release, true);
  return () => {
    target.document.removeEventListener('pointerdown', press, true);
    target.document.removeEventListener('pointerup', release, true);
    target.document.removeEventListener('pointercancel', release, true);
    viewport.removeEventListener('resize', update);
    viewport.removeEventListener('scroll', update);
    target.removeEventListener('scroll', update);
    target.document.removeEventListener('focusin', update);
    target.document.removeEventListener('focusout', update);
    root.style.removeProperty('--keyboard-inset');
    root.style.removeProperty('--visual-vh');
    root.style.removeProperty('--visual-top');
    root.removeAttribute('data-visual-keyboard');
    root.removeAttribute('data-text-focus');
  };
}
