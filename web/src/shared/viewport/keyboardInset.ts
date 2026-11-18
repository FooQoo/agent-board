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
 * Keeps `--keyboard-inset` and `--visual-vh` on the root up to date from the visual viewport, for as
 * long as the caller is mounted. A sheet that must stay above the keyboard reads them in CSS.
 */
export function watchKeyboardInset(target: Window = window): () => void {
  const viewport = target.visualViewport;
  if (!viewport) return () => {};
  const root = target.document.documentElement;
  const update = () => {
    root.style.setProperty('--keyboard-inset', `${keyboardInset(root.clientHeight, viewport)}px`);
    root.style.setProperty('--visual-vh', `${Math.round(viewport.height)}px`);
  };
  update();
  viewport.addEventListener('resize', update);
  viewport.addEventListener('scroll', update);
  return () => {
    viewport.removeEventListener('resize', update);
    viewport.removeEventListener('scroll', update);
    root.style.removeProperty('--keyboard-inset');
    root.style.removeProperty('--visual-vh');
  };
}
