import { useEffect, useRef } from 'react';
import type { PresentationGate } from '../../shared/data/core';
import { claimBuildReload } from './buildReload';

/**
 * Reloads the page when the server runs another build than the one this page loaded. `served` is
 * the build ID from the latest `ready` event; while `busy` (an open edit or answer) the reload
 * waits until the work is done. With a `gate`, the reload also waits while a drawer or a modal is
 * open and for the cooldown after it closes, like any other update the stream causes.
 */
export function useBuildReload(
  served: string | null,
  busy: boolean,
  gate?: Pick<PresentationGate, 'submit'>,
): void {
  const busyRef = useRef(busy);
  busyRef.current = busy;
  useEffect(() => {
    if (served === null || busy) return;
    const reload = () => {
      // Work may have started while the reload waited; the effect tries again when it is done.
      if (!busyRef.current && claimBuildReload(served)) window.location.reload();
    };
    if (gate) gate.submit(reload, { key: 'build-reload' });
    else reload();
  }, [served, busy, gate]);
}
