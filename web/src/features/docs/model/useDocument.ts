import { useCallback, useEffect, useRef, useState } from 'react';
import { FetchError } from '@/shared/api/http';
import type { ProjectId } from '@/shared/api/contracts';
import { fetchDocsFile, type DocsFile } from '../api/docsApi';

export type DocumentState =
  | { status: 'idle' | 'loading' | 'error'; file: null }
  | { status: 'ready'; file: DocsFile };

/** What a quiet read of the open file found. */
export type FileRefresh = 'updated' | 'unchanged' | 'deleted' | 'failed';

/**
 * One file of the docs, fetched when `path` is chosen (nothing is fetched while it is null).
 * `loadId` changes with every fresh load. `refresh` reads the file again without the loading
 * state, for a change made outside: the shown file is replaced only when its revision differs,
 * and is kept when the file is gone or the read fails.
 */
export function useDocument(projectId: ProjectId, path: string | null) {
  const [state, setState] = useState<DocumentState>({ status: 'idle', file: null });
  const [attempt, setAttempt] = useState(0);
  const current = useRef(state);
  current.current = state;

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
  const refresh = useCallback(async (): Promise<FileRefresh> => {
    if (path === null) return 'unchanged';
    try {
      const file = await fetchDocsFile(projectId, path);
      const shown = current.current.file;
      if (shown === null || shown.path !== path || shown.revision === file.revision)
        return 'unchanged';
      setState({ status: 'ready', file });
      return 'updated';
    } catch (cause) {
      return cause instanceof FetchError && cause.status === 404 ? 'deleted' : 'failed';
    }
  }, [projectId, path]);
  return {
    status: state.status,
    file: state.file,
    loadId: `${path}:${attempt}`,
    reload,
    refresh,
  };
}
