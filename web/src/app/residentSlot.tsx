import type { ReactNode } from 'react';
import { ConnectedResidentIndicator } from '../features/resident-sessions/ui/ResidentFooter';
import { ResidentHost } from '../features/resident-sessions/ui/ResidentHost';
import { isProjectId } from './model/projectSession';
import { usesRemoteSession } from './remote/session';

/** The sample-data mode and the demo have no server, so they have no session to show or start. */
const serverless = import.meta.env.MODE === 'mock' || import.meta.env.MODE === 'demo';

/** Whether the resident-session row, dialog and footer indicator exist for this project. */
export const residentAvailable = (projectId: string | null): projectId is string =>
  !serverless && isProjectId(projectId);

/**
 * The footer indicator of the board. Through the remote entrance it is display-only, because the
 * launch, stop, model and auto-start routes are served on the local listener only.
 */
export function residentFooterSlot(projectId: string | null): ReactNode {
  if (!residentAvailable(projectId)) return undefined;
  return <ConnectedResidentIndicator projectId={projectId} remote={usesRemoteSession()} />;
}

/** The dialog the footer and the settings row open; absent on the remote view, which cannot launch. */
export function ResidentDialogHost({ projectId }: { projectId: string | null }) {
  if (!residentAvailable(projectId) || usesRemoteSession()) return null;
  return <ResidentHost key={projectId} projectId={projectId} />;
}
