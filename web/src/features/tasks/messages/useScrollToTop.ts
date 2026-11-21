import { type RefObject, useLayoutEffect, useRef } from 'react';

/**
 * A ref for a scroller that goes back to the top whenever `key` changes (or to `restoreTop` once
 * when it is given and `restoreReady`). The messages body is one
 * scroller shared by the list and every opened message, so without it a screen starts at the
 * scroll position of the one shown before.
 */
export function useScrollToTop<T extends HTMLElement>(
  key: string | null,
  restoreTop?: number,
  restoreReady = true,
) {
  const ref = useRef<T>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: key is the trigger; reset scroll whenever the opened message changes
  useLayoutEffect(() => {
    if (ref.current) ref.current.scrollTop = 0;
  }, [key]);
  // After the reset above, so a restored position is not undone on the first draw.
  useRestoreScroll(ref, restoreTop, restoreReady);
  return ref;
}

/**
 * Puts a scroller back at the position the screen was left at (back from a summary result), once
 * `ready` says its rows are drawn. It acts once.
 */
export function useRestoreScroll(
  ref: RefObject<HTMLElement | null>,
  top: number | undefined,
  ready: boolean,
) {
  const pending = useRef(top ?? null);
  // The body of a sheet can mount, and its rows can be drawn, a frame or two after the first commit.
  // biome-ignore lint/correctness/useExhaustiveDependencies: restored once, when the rows are ready.
  useLayoutEffect(() => {
    if (pending.current === null || !ready) return;
    let frame = 0;
    let tries = 0;
    const settle = () => {
      if (pending.current === null) return;
      // The PC modal's list scrolls in its swipe viewport, a phone sheet in the body itself.
      const body = ref.current;
      const scrollers = body
        ? [body, ...body.querySelectorAll<HTMLElement>('.message-list__viewport')]
        : [];
      const el = scrollers.find(
        (item) => item.scrollHeight - item.clientHeight >= (pending.current ?? 0),
      );
      if (el) {
        el.scrollTop = pending.current;
        pending.current = null;
      } else if (++tries < 60) {
        frame = window.setTimeout(settle, 50);
      }
    };
    settle();
    return () => window.clearTimeout(frame);
  }, [ready]);
}

/** The nearest ancestor of `el` that scrolls (a hidden overflow still scrolls by script), or null. */
export function scrollerOf(el: HTMLElement): HTMLElement | null {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if (overflow !== 'visible' && node.scrollHeight > node.clientHeight) return node;
  }
  return null;
}
