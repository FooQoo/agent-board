// Shows the welcome again when the settings ask for it. The request waits until the board can show
// the guide: no other operation is open, and no guide screen is on screen. It needs no server.

import { useCallback, useEffect, useRef } from 'react';
import { onTutorialRequest } from './tutorialRequest';

export function useTutorialReplay({
  eligible,
  hidden,
  onReplay,
}: {
  eligible: boolean;
  /** True when no guide screen is on screen, so a replay may start. */
  hidden: boolean;
  onReplay: () => void;
}): void {
  const requested = useRef(false);
  const onReplayRef = useRef(onReplay);
  onReplayRef.current = onReplay;

  const replay = useCallback(() => {
    if (!requested.current || !eligible || !hidden) return;
    requested.current = false;
    onReplayRef.current();
  }, [eligible, hidden]);

  useEffect(
    () =>
      onTutorialRequest(() => {
        requested.current = true;
        replay();
      }),
    [replay],
  );
  useEffect(() => {
    replay();
  }, [replay]);
}
