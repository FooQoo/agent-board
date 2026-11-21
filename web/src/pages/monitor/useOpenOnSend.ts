import { useEffect, useRef } from 'react';

/** Calls `open` once for each increase of `sent`, the count of requests the Ask sheet sent. */
export function useOpenOnSend(sent: number, enabled: boolean, open: () => void): void {
  const shown = useRef(sent);
  useEffect(() => {
    if (sent === shown.current) return;
    shown.current = sent;
    if (enabled) open();
  }, [sent, enabled, open]);
}
