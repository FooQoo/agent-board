import { useCallback, useEffect, useState } from 'react';
import type { ProjectId } from '@/shared/api/contracts';
import { fetchDocsFile, type DocsFile } from '../api/docsApi';

export type DocumentState =
  | { status: 'idle' | 'loading' | 'error'; file: null }
  | { status: 'ready'; file: DocsFile };

/**
 * One file of the docs, fetched when `path` is chosen (nothing is fetched while it is null).
 * `loadId` changes with every fresh load, so an editor can start over on the loaded text.
 */
export function useDocument(projectId: ProjectId, path: string | null) {
  const [state, setState] = useState<DocumentState>({ status: 'idle', file: null });
  const [attempt, setAttempt] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` is the reload trigger.
  useEffect(() => {
    if (path === null) {
      setState({ status: 'idle', file: null });
      return;
    }
    let current = true;
    setState({ status: 'loading', file: null });
    fetchDocsFile(projectId, path).then(
      (file) => current && setState({ status: 'ready', file }),
      () => current && setState({ status: 'error', file: null }),
    );
    return () => {
      current = false;
    };
  }, [projectId, path, attempt]);

  const reload = useCallback(() => setAttempt((value) => value + 1), []);
  return { status: state.status, file: state.file, loadId: `${path}:${attempt}`, reload };
}
