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

/**
 * Keeps `--keyboard-inset`, `--visual-vh` and `--visual-top` on the root up to date from the visual
 * viewport, for as long as the caller is mounted, and marks the root with `data-visual-keyboard`
 * while the keyboard covers the page. A sheet that must stay above the keyboard reads them in CSS:
 * `--visual-top` is where the visible area starts in the layout viewport, which iOS Safari moves
 * when it scrolls the page to a focused field.
 */
export function watchKeyboardInset(target: Window = window): () => void {
  const viewport = target.visualViewport;
  if (!viewport) return () => {};
  const root = target.document.documentElement;
  const update = () => {
    root.style.setProperty('--keyboard-inset', `${keyboardInset(root.clientHeight, viewport)}px`);
    root.style.setProperty('--visual-vh', `${Math.round(viewport.height)}px`);
    root.style.setProperty('--visual-top', `${Math.round(viewport.offsetTop)}px`);
    root.toggleAttribute('data-visual-keyboard', keyboardInset(root.clientHeight, viewport) > 0);
  };
  update();
  viewport.addEventListener('resize', update);
  viewport.addEventListener('scroll', update);
  // iOS scrolls the page itself when a field gets the focus; follow that as well.
  target.addEventListener('scroll', update);
  return () => {
    viewport.removeEventListener('resize', update);
    viewport.removeEventListener('scroll', update);
    target.removeEventListener('scroll', update);
    root.style.removeProperty('--keyboard-inset');
    root.style.removeProperty('--visual-vh');
    root.style.removeProperty('--visual-top');
    root.removeAttribute('data-visual-keyboard');
  };
}
