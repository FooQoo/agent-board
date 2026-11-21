import { useLayoutEffect, useRef } from 'react';

/**
 * A ref for a scroller that goes back to the top whenever `key` changes. The messages body is one
 * scroller shared by the list and every opened message, so without it a screen starts at the
 * scroll position of the one shown before.
 */
export function useScrollToTop<T extends HTMLElement>(key: string | null) {
  const ref = useRef<T>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: key is the trigger; reset scroll whenever the opened message changes
  useLayoutEffect(() => {
    if (ref.current) ref.current.scrollTop = 0;
  }, [key]);
  return ref;
}
