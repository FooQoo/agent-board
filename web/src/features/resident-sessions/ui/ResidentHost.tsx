import { lazy, Suspense, useEffect, useState } from 'react';
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
  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <ResidentDialog key={projectId} projectId={projectId} onClose={() => setOpen(false)} />
    </Suspense>
  );
}
