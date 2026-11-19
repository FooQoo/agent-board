import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProjectId } from '../../shared/api/contracts';
import { getSessions, type SessionsSnapshot } from './api';
import { onResidentChanged } from './events';

/** The footer asks this often; the open dialog asks faster, because its buttons wait on the answer. */
export const FOOTER_POLL_MS = 5000;
export const DIALOG_POLL_MS = 2000;

/**
 * The sessions of a project, read from `GET /api/projects/{id}/sessions` every `intervalMs` (null
 * stops it), after each change the dialog reports, and when the page becomes visible again. The
 * server sends no event for sessions, so this is the only refresh. A failed read keeps the last
 * snapshot and sets `failed`.
 */
export function useResidentSession(projectId: ProjectId | null, intervalMs: number | null) {
  // The snapshot is kept with its project, so a project change never shows the previous one's.
  const [held, setHeld] = useState<{ id: ProjectId; snapshot: SessionsSnapshot } | null>(null);
  const [failed, setFailed] = useState(false);
  // The project of the latest request, so a late answer for another project is dropped.
  const latest = useRef<ProjectId | null>(null);

  const refresh = useCallback(async () => {
    if (projectId === null) return;
    latest.current = projectId;
    try {
      const next = await getSessions(projectId);
      if (latest.current !== projectId) return;
      setHeld({ id: projectId, snapshot: next });
      setFailed(false);
    } catch {
      if (latest.current === projectId) setFailed(true);
    }
  }, [projectId]);

  useEffect(() => {
    if (projectId === null || intervalMs === null) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), intervalMs);
    const visible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', visible);
    const stopChanges = onResidentChanged(() => void refresh());
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
      stopChanges();
    };
  }, [projectId, intervalMs, refresh]);

  return { snapshot: held?.id === projectId ? held.snapshot : null, failed, refresh };
}
