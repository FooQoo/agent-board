import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import type { ProjectId } from '../../api/contracts';
import type { DetailSection } from '../api/contracts';
import type { ResourceKey, SectionSnapshot } from '../core/types';
import { useDataCore } from './provider';

const NONE: ResourceKey = { kind: 'task', projectId: '', id: 0 };
const ALL: DetailSection[] = ['document', 'history'];

export interface UseTaskDetailResult {
  document: SectionSnapshot<'document'>;
  history: SectionSnapshot<'history'>;
  /** Fetches the cached sections again now; the presentation hold does not delay it. */
  refresh(): Promise<void>;
}

/**
 * A task's Detail. Only `sections` are fetched; the task stays in the cache while this is
 * mounted and may be dropped afterwards.
 */
export function useTaskDetail(
  projectId: ProjectId,
  id: number | null,
  sections: DetailSection[] = ALL,
): UseTaskDetailResult {
  const core = useDataCore();
  const key = useMemo<ResourceKey | null>(
    () => (id === null ? null : { kind: 'task', projectId, id }),
    [projectId, id],
  );
  const wanted = sections.join(',');
  // biome-ignore lint/correctness/useExhaustiveDependencies: `wanted` stands for `sections`
  useEffect(() => (key ? core.openDetail(key, sections) : undefined), [core, key, wanted]);
  const snapshot = useSyncExternalStore(core.store.subscribe, () =>
    core.store.getResource(key ?? NONE),
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: `wanted` stands for `sections`
  const refresh = useCallback(
    () => (key ? core.refreshDetail(key, sections) : Promise.resolve()),
    [core, key, wanted],
  );
  return { document: snapshot.document, history: snapshot.history, refresh };
}
