// Starts the guide again when the settings ask for it. The request waits until the board can show
// the guide: no other operation is open, and no guide screen is on screen.

import { useCallback, useEffect, useRef } from 'react';
import type { ProjectId } from '../../shared/api/contracts';
import { type GuideState, readGuide, replayGuide } from './api';
import { onTutorialRequest } from './tutorialRequest';

export function useTutorialReplay({
  eligible,
  projectId,
  clientId,
  hidden,
  onReplayed,
}: {
  eligible: boolean;
  projectId: ProjectId | null;
  clientId: string;
  /** True when no guide screen is on screen, so a replay may start. */
  hidden: boolean;
  onReplayed: (state: GuideState) => void;
}): void {
  const requested = useRef(false);
  const onReplayedRef = useRef(onReplayed);
  onReplayedRef.current = onReplayed;

  const replay = useCallback(() => {
    if (!requested.current || !eligible || !projectId || !hidden) return;
    requested.current = false;
    void (async () => {
      try {
        const current = await readGuide();
        onReplayedRef.current(await replayGuide(clientId, current.revision));
      } catch {
        // A refused request leaves the board as it is; the user can ask again.
      }
    })();
  }, [eligible, projectId, clientId, hidden]);

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
