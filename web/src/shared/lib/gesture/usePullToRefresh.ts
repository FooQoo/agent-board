import { type RefObject, useEffect, useRef, useState } from 'react';

/** What pulling down at the top of a scrolling list shows above its cards. */
export type PullState = 'idle' | 'pulling' | 'ready' | 'refreshing';

/** How far the cards follow the finger, in px, before a release refreshes. */
export const READY_OFFSET = 44;
/** The most the cards follow the finger, in px. */
const PULL_MAX = 80;
/** The height the indicator keeps while the board refreshes. */
export const REFRESHING_HEIGHT = 48;
/** The spinner stays this long after the refresh ends, so a fast refresh does not flash. */
const SETTLE_MS = 600;

interface Options {
  /** The element that holds the list; touches inside it are watched. */
  container: RefObject<HTMLElement | null>;
  /** Finds the scrolling list that can be pulled (the lane on screen, the sheet's body). */
  scroller: (container: HTMLElement) => HTMLElement | null;
  onRefresh?: () => void;
  /** A refresh the person asked for is running. */
  refreshing?: boolean;
}

/**
 * Pull to refresh for the list on screen: a downward drag that starts while the list is at its top
 * moves the cards with the finger (damped), and a release past the threshold refreshes. A sideways
 * swipe, a drag up, or a list that is already scrolled is left to the scroll and the carousel.
 */
export function usePullToRefresh({ container, scroller, onRefresh, refreshing = false }: Options) {
  const [offset, setOffset] = useState(0);
  const [held, setHeld] = useState(false);
  const latest = useRef({ onRefresh, refreshing, scroller });
  latest.current = { onRefresh, refreshing, scroller };
  const enabled = onRefresh !== undefined;

  // The spinner outlasts a quick refresh by a moment.
  const [settling, setSettling] = useState(false);
  useEffect(() => {
    if (refreshing) {
      setSettling(true);
      return;
    }
    const timer = setTimeout(() => setSettling(false), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [refreshing]);

  useEffect(() => {
    const root = container.current;
    if (!root || !enabled) return;
    let start: { x: number; y: number } | null = null;
    let pulling = false;
    let current = 0;
    const reset = () => {
      start = null;
      pulling = false;
      current = 0;
      setHeld(false);
      setOffset(0);
    };
    const onStart = (event: TouchEvent) => {
      const list = latest.current.scroller(root);
      const touch = event.touches[0];
      const atTop = list?.contains(event.target as Node) && list.scrollTop <= 0;
      start =
        event.touches.length === 1 && touch && atTop && !latest.current.refreshing
          ? { x: touch.clientX, y: touch.clientY }
          : null;
    };
    const onMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!start || !touch) return;
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      if (!pulling) {
        // Decided by the first clear movement: down and more vertical than sideways.
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        if (dy <= 0 || Math.abs(dx) > Math.abs(dy)) {
          start = null;
          return;
        }
        pulling = true;
        setHeld(true);
      }
      if (event.cancelable) event.preventDefault();
      current = Math.min(PULL_MAX, dy * 0.5);
      setOffset(current);
    };
    const onEnd = () => {
      const refresh = pulling && current >= READY_OFFSET;
      reset();
      if (refresh) latest.current.onRefresh?.();
    };
    root.addEventListener('touchstart', onStart, { passive: true });
    root.addEventListener('touchmove', onMove, { passive: false });
    root.addEventListener('touchend', onEnd);
    root.addEventListener('touchcancel', reset);
    return () => {
      root.removeEventListener('touchstart', onStart);
      root.removeEventListener('touchmove', onMove);
      root.removeEventListener('touchend', onEnd);
      root.removeEventListener('touchcancel', reset);
    };
  }, [container, enabled]);

  const busy = refreshing || settling;
  const state: PullState = busy
    ? 'refreshing'
    : offset >= READY_OFFSET
      ? 'ready'
      : held
        ? 'pulling'
        : 'idle';
  return { state, offset: busy ? REFRESHING_HEIGHT : offset, held };
}
