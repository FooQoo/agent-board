import { useEffect } from 'react';
import { claimBuildReload } from './buildReload';

/**
 * Reloads the page when the server runs another build than the one this page loaded. `served` is
 * the build ID from the latest `ready` event; while `busy` (an open edit or answer) the reload
 * waits until the work is done.
 */
export function useBuildReload(served: string | null, busy: boolean): void {
  useEffect(() => {
    if (served === null || busy) return;
    if (claimBuildReload(served)) window.location.reload();
  }, [served, busy]);
}
