import { useEffect } from 'react';

/** Tells the parent whether a surface is open, and that it is closed once the view goes away. */
export function useReportOpen(open: boolean, report: ((open: boolean) => void) | undefined) {
  useEffect(() => {
    report?.(open);
    return () => report?.(false);
  }, [open, report]);
}
