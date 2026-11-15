import { useSyncExternalStore } from 'react';

/** Below this width the board shows the phone layout. At and above it, the PC board. */
export const NARROW_VIEWPORT_QUERY = '(max-width: 767px)';

function subscribe(onChange: () => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => {};
  const query = window.matchMedia(NARROW_VIEWPORT_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function snapshot(): boolean {
  return typeof window.matchMedia === 'function'
    ? window.matchMedia(NARROW_VIEWPORT_QUERY).matches
    : false;
}

/** Whether the window is narrower than 768px. It follows a resize while the page is open. */
export function useNarrowViewport(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
