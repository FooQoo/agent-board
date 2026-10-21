import { useEffect, useRef, useState } from 'react';
import { applyPreferenceEvent } from '../../shared/preferences';
import { readyBuildId } from '../../shared/lib/build/buildId';

/**
 * The one shared subscription to `/api/events`. `onRefresh` runs on every `ready` and `changed`
 * (the project list and the shown board are fetched again by the caller); an `error` marks the stream
 * as down until the browser reconnects and the next `ready` arrives. `serverBuild` is the build ID
 * the latest `ready` named. The stream is closed on cleanup.
 */
export function useBoardEvents(onRefresh: () => void): {
  streamDown: boolean;
  serverBuild: string | null;
} {
  const [streamDown, setStreamDown] = useState(false);
  const [serverBuild, setServerBuild] = useState<string | null>(null);
  const refresh = useRef(onRefresh);
  refresh.current = onRefresh;

  useEffect(() => {
    const source = new EventSource('/api/events');
    const changed = () => {
      setStreamDown(false);
      refresh.current();
    };
    const lost = () => setStreamDown(true);
    source.addEventListener('ready', (event) => {
      setServerBuild(readyBuildId(event));
      changed();
    });
    source.addEventListener('changed', changed);
    // The saved language and theme are shown at once; the board is not read again for them.
    source.addEventListener('preferences', applyPreferenceEvent);
    source.addEventListener('error', lost);
    return () => source.close();
  }, []);

  return { streamDown, serverBuild };
}
