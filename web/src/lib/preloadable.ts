import { type ComponentType, createElement, lazy, useState } from 'react';

/**
 * A component whose code is split out of the first script. `preload` fetches it, and a page calls
 * it once its first screen is shown, so the code is usually there before the component is needed.
 * An instance created after the code arrived renders at once; one created before suspends until it
 * arrives, so the caller wraps it in `Suspense`.
 */
export function preloadable<P extends object>(
  load: () => Promise<ComponentType<P>>,
): { Component: ComponentType<P>; preload: () => Promise<ComponentType<P>> } {
  let loaded: ComponentType<P> | null = null;
  let pending: Promise<ComponentType<P>> | null = null;
  const preload = () => {
    pending ??= load().then(
      (component) => {
        loaded = component;
        return component;
      },
      (error: unknown) => {
        // A failed fetch can be tried again by the next caller.
        pending = null;
        throw error;
      },
    );
    return pending;
  };
  const Lazy = lazy(async () => ({ default: await preload() }));
  function Preloadable(props: P) {
    // The element type stays the same for the life of an instance, so it is never remounted.
    const [type] = useState<ComponentType<P>>(() => loaded ?? Lazy);
    return createElement(type, props);
  }
  return { Component: Preloadable, preload };
}
