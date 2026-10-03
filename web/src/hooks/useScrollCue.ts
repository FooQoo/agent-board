import { type RefObject, useCallback, useEffect, useLayoutEffect, useState } from 'react';

/**
 * Returns true while the element has content scrolled out of view below it.
 * Recomputes on scroll, on element resize, and whenever `dep` changes.
 */
export function useScrollCue(ref: RefObject<HTMLElement | null>, dep: unknown): boolean {
  const [more, setMore] = useState(false);

  const measure = useCallback(() => {
    const el = ref.current;
    setMore(el ? el.scrollHeight - el.scrollTop - el.clientHeight > 1 : false);
  }, [ref]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: dep signals content changes
  useLayoutEffect(measure, [measure, dep]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.addEventListener('scroll', measure, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(el);
    return () => {
      el.removeEventListener('scroll', measure);
      observer?.disconnect();
    };
  }, [ref, measure]);

  return more;
}
