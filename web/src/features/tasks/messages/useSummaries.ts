import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ProjectId } from '@/shared/api/contracts';
import { useOptionalDataCore } from '@/shared/data/react';
import type { PeriodicSummary, SummariesApi } from './model/messages';

export interface SummariesController {
  /** The summaries not dismissed, newest first; empty until the first read arrives. */
  summaries: readonly PeriodicSummary[];
  /** The project the summaries belong to; a result link names it. */
  projectId: ProjectId;
  /** The first read has not arrived yet. */
  loading: boolean;
  /** The last dismissal failed: its summary is back in the list. Cleared by the next one. */
  dismissFailed: boolean;
  /** Hides the summary at once and asks the server; a failure brings it back. */
  dismiss: (summaryId: string) => void;
}

/**
 * The periodic summaries of a project. They are read when the list opens and again whenever the
 * stream says the project's `messages` changed with the `summary` facet (or the stream can no
 * longer be trusted). A dismissed summary is hidden before the server answers.
 */
export function useSummaries(
  api: SummariesApi | undefined,
  projectId: ProjectId,
): SummariesController {
  const core = useOptionalDataCore();
  const [read, setRead] = useState<readonly PeriodicSummary[] | null>(null);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [dismissFailed, setDismissFailed] = useState(false);
  // Only the newest read is applied, so a slow answer never replaces a newer list.
  const reads = useRef(0);

  const load = useCallback(() => {
    if (!api) return;
    const mine = ++reads.current;
    api
      .list(projectId)
      .then((list) => {
        if (mine === reads.current) setRead(list);
      })
      .catch(() => {
        // The list stays as it was; the next change or opening reads it again.
        if (mine === reads.current) setRead((current) => current ?? []);
      });
  }, [api, projectId]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (!api || !core) return undefined;
    return core.subscribeChanges((event) => {
      if (event === null) return load();
      if (event.projectId !== projectId) return;
      if (event.changes.some((c) => c.resource === 'messages' && c.facets.includes('summary')))
        load();
    });
  }, [api, core, projectId, load]);

  const dismiss = useCallback(
    (summaryId: string) => {
      if (!api) return;
      setDismissFailed(false);
      setHidden((current) => new Set(current).add(summaryId));
      api.dismiss(projectId, summaryId).catch(() => {
        setHidden((current) => {
          const next = new Set(current);
          next.delete(summaryId);
          return next;
        });
        setDismissFailed(true);
      });
    },
    [api, projectId],
  );

  const summaries = useMemo(
    () => (read ?? []).filter((summary) => !hidden.has(summary.id)),
    [read, hidden],
  );
  return {
    projectId,
    summaries,
    loading: api !== undefined && read === null,
    dismissFailed,
    dismiss,
  };
}
