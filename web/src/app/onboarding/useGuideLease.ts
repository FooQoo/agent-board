// Keeps the guide's lease while a guide screen is on screen: the tab renews it on a timer.

import { useEffect, useRef } from 'react';
import { type GuideState, heartbeatGuide } from './api';
import { HEARTBEAT_MS } from './guideTiming';

export function useGuideLease({
  active,
  clientId,
  apply,
  onLost,
}: {
  active: boolean;
  clientId: string;
  apply: (state: GuideState) => void;
  /** Called when the lease cannot be renewed; the guide then leaves the screen. */
  onLost: () => void;
}): void {
  const lost = useRef(onLost);
  lost.current = onLost;
  useEffect(() => {
    if (!active) return undefined;
    const timer = window.setInterval(() => {
      void heartbeatGuide(clientId)
        .then(apply)
        .catch(() => lost.current());
    }, HEARTBEAT_MS);
    return () => window.clearInterval(timer);
  }, [active, clientId, apply]);
}
