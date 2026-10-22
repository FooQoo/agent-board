import { useEffect } from 'react';
import { useDataCore } from './provider';

/**
 * Holds automatic updates back while `open` is true (a drawer, a modal) and for 3 seconds after
 * it turns false. Opening again within that time cancels the countdown.
 */
export function usePresentationHold(open: boolean, token = 'view'): void {
  const core = useDataCore();
  useEffect(() => (open ? core.gate.acquire(token) : undefined), [core, open, token]);
}
