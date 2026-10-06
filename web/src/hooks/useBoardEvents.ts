import { useEffect, useRef, useState } from 'react';

/**
 * The one shared subscription to `/api/events`. `onRefresh` runs on every `ready` and `changed`
 * (the project list and the shown board are fetched again by the caller); an `error` marks the stream
 * as down until the browser reconnects and the next `ready` arrives. The stream is closed on cleanup.
 */
export function useBoardEvents(onRefresh: () => void): { streamDown: boolean } {
  const [streamDown, setStreamDown] = useState(false);
  const refresh = useRef(onRefresh);
  refresh.current = onRefresh;

  useEffect(() => {
    const source = new EventSource('/api/events');
    const changed = () => {
      setStreamDown(false);
      refresh.current();
    };
    const lost = () => setStreamDown(true);
    source.addEventListener('ready', changed);
    source.addEventListener('changed', changed);
    source.addEventListener('error', lost);
    return () => source.close();
  }, []);

  return { streamDown };
}
