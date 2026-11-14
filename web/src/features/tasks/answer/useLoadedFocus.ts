import { useEffect } from 'react';

/**
 * A question is read after the dialog or the sheet opens: when it arrives and the focus is still
 * outside it, on the container itself, or on the sheet's handle, it moves to the first option, as it
 * would have on opening.
 */
export function useLoadedFocus(containerSelector: string, loaded: boolean) {
  useEffect(() => {
    if (!loaded) return;
    const container = document.querySelector<HTMLElement>(containerSelector);
    const active = document.activeElement;
    if (container === null) return;
    // Where the focus is before anything inside can take it: the opener behind the dialog, the
    // container itself, or the sheet's drag handle.
    const resting =
      active === null ||
      !container.contains(active) ||
      (active as HTMLElement).matches(`${containerSelector}, .mobile-drawer__handle`);
    if (!resting) return;
    container
      .querySelector<HTMLElement>('[role="radio"], textarea')
      ?.focus({ preventScroll: true });
  }, [containerSelector, loaded]);
}
