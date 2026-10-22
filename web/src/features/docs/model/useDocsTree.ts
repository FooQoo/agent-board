import { useCallback, useEffect, useState } from 'react';
import type { ProjectId } from '@/shared/api/contracts';
import { fetchDocsTree, type DocsTree } from '../api/docsApi';

export type DocsTreeState =
  | { status: 'loading'; tree: null }
  | { status: 'error'; tree: null }
  | { status: 'ready'; tree: DocsTree };

/**
 * The file list of a project's docs. It is fetched when the dialog opens (this hook mounts) and
 * again only when `reload` is called; opening or closing a folder does not fetch.
 */
export function useDocsTree(projectId: ProjectId) {
  const [state, setState] = useState<DocsTreeState>({ status: 'loading', tree: null });
  const [attempt, setAttempt] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` is the reload trigger.
  useEffect(() => {
    let current = true;
    setState({ status: 'loading', tree: null });
    fetchDocsTree(projectId).then(
      (tree) => current && setState({ status: 'ready', tree }),
      () => current && setState({ status: 'error', tree: null }),
    );
    return () => {
      current = false;
    };
  }, [projectId, attempt]);

  const reload = useCallback(() => setAttempt((value) => value + 1), []);
  return {
    status: state.status,
    nodes: state.tree?.nodes ?? [],
    truncated: state.tree?.truncated ?? false,
    reload,
  };
}
