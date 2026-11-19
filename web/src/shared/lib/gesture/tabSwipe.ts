import { type PointerEvent, useRef } from 'react';
import { swipeAxis } from './sideSwipe';

/**
 * Whether a press on `target` must not switch the tabs: a control, a text field, code, a picture, a
 * table or anything else that scrolls sideways itself, or a dialog other than the one `panel` is in.
 */
export function shouldIgnoreTabSwipe(target: EventTarget | null, panel: HTMLElement): boolean {
  if (!(target instanceof Element)) return false;
  const targetDialog = target.closest('[role="dialog"]');
  const panelDialog = panel.closest('[role="dialog"]');
  if (targetDialog && targetDialog !== panelDialog) return true;
  if (
    target.closest(
      'button, a, input, textarea, select, summary, [contenteditable="true"], [data-no-tab-swipe], table, pre, code, img, picture, figure, .lightbox, .mermaid, .diagram',
    )
  )
    return true;
  let node: Element | null = target;
  while (node && node !== panel) {
    const style = getComputedStyle(node);
    if (
      (style.overflowX === 'auto' || style.overflowX === 'scroll') &&
      node.scrollWidth > node.clientWidth + 1
    )
      return true;
    node = node.parentElement;
  }
  return false;
}

/** How far (px) a sideways flick must travel to switch the tab. */
export const TAB_FLICK_DISTANCE = 48;

/**
 * Switches tabs by a sideways flick of a finger or a pen on `panel` (a PC detail panel on a tablet).
 * A mouse is left alone, so it can still select text; a press that turns into a vertical scroll, or
 * that starts on something `shouldIgnoreTabSwipe` keeps, switches nothing. Left goes to the next tab.
 */
export function useTabFlick<Tab extends string>(
  tabs: readonly Tab[],
  current: Tab,
  onChange: (tab: Tab) => void,
  enabled = true,
) {
  const press = useRef<{ x: number; y: number; axis: 'x' | 'y' | null } | null>(null);
  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    press.current = null;
    if (!enabled || event.pointerType === 'mouse' || !event.isPrimary) return;
    if (shouldIgnoreTabSwipe(event.target, event.currentTarget)) return;
    press.current = { x: event.clientX, y: event.clientY, axis: null };
  };
  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const start = press.current;
    if (!start || start.axis) return;
    start.axis = swipeAxis(event.clientX - start.x, event.clientY - start.y);
  };
  const onPointerUp = (event: PointerEvent<HTMLElement>) => {
    const start = press.current;
    press.current = null;
    if (!start || start.axis === 'y') return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) < TAB_FLICK_DISTANCE || Math.abs(dx) <= Math.abs(dy)) return;
    const next = tabs[tabs.indexOf(current) + (dx < 0 ? 1 : -1)];
    if (next !== undefined) onChange(next);
  };
  const onPointerCancel = () => {
    press.current = null;
  };
  return enabled ? { onPointerDown, onPointerMove, onPointerUp, onPointerCancel } : {};
}
