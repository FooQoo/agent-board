// One command at a time. The flag is set before the request and cleared when its answer arrives,
// so a second press that lands before the button re-renders as disabled is ignored, not sent again.

import { useCallback, useRef, useState } from 'react';

export function useInFlight() {
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const begin = useCallback(() => {
    if (inFlight.current) return false;
    inFlight.current = true;
    setBusy(true);
    return true;
  }, []);
  const settle = useCallback(() => {
    inFlight.current = false;
    setBusy(false);
  }, []);
  return { busy, begin, settle };
}
