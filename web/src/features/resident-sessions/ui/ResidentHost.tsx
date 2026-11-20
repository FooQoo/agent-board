import { lazy, Suspense, useEffect, useState } from 'react';
import { onDismissSettingsSheets } from '@/shared/lib/sheets/dismissSheets';
import { onResidentDialogRequest } from '../events';

// The dialog's code loads when it is first asked for, not with the board.
const ResidentDialog = lazy(() => import('./ResidentDialog'));

/**
 * Keeps the resident-session dialog for a project and opens it when the footer or the settings
 * ask. The caller keys it by project, so a project change closes the dialog of the previous one.
 */
export function ResidentHost({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => onResidentDialogRequest(() => setOpen(true)), []);
  // The phone bar switching tabs closes the dialog, so the chosen screen is the one on show.
  useEffect(() => onDismissSettingsSheets(() => setOpen(false)), []);
  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <ResidentDialog key={projectId} projectId={projectId} onClose={() => setOpen(false)} />
    </Suspense>
  );
}
