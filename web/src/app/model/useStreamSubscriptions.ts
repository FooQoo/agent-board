import { type RefObject, useCallback } from 'react';
import type { ProjectId } from '../../shared/api/contracts';
import type { usePcConnection } from '../data/PcData';

type Adapter = ReturnType<typeof usePcConnection>['adapter'];

/**
 * What the dialogs that follow the stream subscribe to. The Docs dialog follows its own files: a
 * `docs` note names the project, and a reopened stream may have missed notes for any project. The
 * previews follow their card or epic: any other note of the active project may be a change to it,
 * and the preview reads again and compares, so nothing here narrows the notes. Neither is board
 * data, so nothing here waits.
 */
export function useStreamSubscriptions(adapter: Adapter, activeRef: RefObject<ProjectId | null>) {
  const subscribeDocs = useCallback(
    (listener: (projectId: string | null) => void) =>
      adapter.subscribe((note) => {
        if (note.type === 'docs') listener(note.projectId);
        else if (note.type === 'sync') listener(null);
      }),
    [adapter],
  );
  const subscribeChanges = useCallback(
    (listener: () => void) =>
      adapter.subscribe((note) => {
        if (note.type === 'docs') return;
        if (note.type === 'sync' || note.event.projectId === activeRef.current) listener();
      }),
    [adapter, activeRef],
  );
  return { subscribeDocs, subscribeChanges };
}
