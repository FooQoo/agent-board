import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { onNotificationDialogRequest } from '../events';

// The dialog's code loads when it is first asked for, not with the board.
const NotificationDialog = lazy(() => import('./NotificationDialog'));

/** Keeps the phone notification dialog and opens it when the settings row asks. */
export function NotificationHost({ push }: { push?: ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => onNotificationDialogRequest(() => setOpen(true)), []);
  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <NotificationDialog onClose={() => setOpen(false)} push={push} />
    </Suspense>
  );
}
