import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import type { ProjectId } from '../../api/contracts';
import type { ResourceKey, SectionSnapshot } from '../core/types';
import { useDataCore } from './provider';

const NONE: ResourceKey = { kind: 'epic', projectId: '', id: '' };

export interface UseEpicDetailResult {
  document: SectionSnapshot<'document'>;
  /** Fetches the document again now; the presentation hold does not delay it. */
  refresh(): Promise<void>;
}

/** An epic's document. The epic stays in the cache while this is mounted. */
export function useEpicDetail(projectId: ProjectId, id: string | null): UseEpicDetailResult {
  const core = useDataCore();
  const key = useMemo<ResourceKey | null>(
    () => (id === null ? null : { kind: 'epic', projectId, id }),
    [projectId, id],
  );
  useEffect(() => (key ? core.openDetail(key, ['document']) : undefined), [core, key]);
  const snapshot = useSyncExternalStore(core.store.subscribe, () =>
    core.store.getResource(key ?? NONE),
  );
  const refresh = useCallback(
    () => (key ? core.refreshDetail(key, ['document']) : Promise.resolve()),
    [core, key],
  );
  return { document: snapshot.document, refresh };
}
