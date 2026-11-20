import { useEffect, useState } from 'react';
import type { ProjectId } from '../../shared/api/contracts';
import { getSessionLog, type SessionLog, type SessionTool } from './api';

/** The open dialog reads the log this often. */
export const LOG_POLL_MS = 2000;

/** What the log pane draws: the last tail read, and whether the latest read failed. */
export interface LogState {
  /** Null until the first read of the tool finishes. */
  data: SessionLog | null;
  failed: boolean;
}

/**
 * The tail of a tool's log, read from `GET /api/projects/{id}/sessions/log` every `intervalMs`
 * for as long as the caller is mounted. The next read is scheduled only after the previous one
 * ends, so requests never overlap, and nothing is read while the tab is hidden. A failed read
 * keeps the last tail and sets `failed`.
 */
export function useSessionLog(
  projectId: ProjectId,
  tool: SessionTool,
  intervalMs: number = LOG_POLL_MS,
): LogState {
  const [state, setState] = useState<LogState>({ data: null, failed: false });

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    setState({ data: null, failed: false });
    const tick = async () => {
      if (document.visibilityState === 'visible') {
        try {
          const next = await getSessionLog(projectId, tool);
          if (cancelled) return;
          // An unchanged tail keeps the same object, so the pane does not render again.
          setState((current) =>
            current.data?.text === next.text &&
            current.data.exists === next.exists &&
            current.data.truncated === next.truncated &&
            !current.failed
              ? current
              : { data: next, failed: false },
          );
        } catch {
          if (cancelled) return;
          setState((current) => (current.failed ? current : { ...current, failed: true }));
        }
      }
      if (!cancelled) timer = window.setTimeout(() => void tick(), intervalMs);
    };
    void tick();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [projectId, tool, intervalMs]);

  return state;
}
