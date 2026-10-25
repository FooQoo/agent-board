import { useEffect, useRef, useState } from 'react';
import type { ProjectId } from '@/shared/api/contracts';
import type { DocsTree, DocsTreeNode } from '../api/docsApi';
import type { FileRefresh } from './useDocument';

/** Calls the listener when a project's Docs may have changed (`null`: any project). */
export type DocsChangeSubscription = (listener: (projectId: string | null) => void) => () => void;

/** What happened to the open file outside the board, and when it was noticed. */
export interface DocsNotice {
  kind: 'updated' | 'deleted';
  path: string;
  at: Date;
}

export interface UseDocsFollowOptions {
  projectId: ProjectId;
  subscribe?: DocsChangeSubscription;
  /** The open file, or null. */
  path: string | null;
  /** Reads the file list again without the loading state; null when the read failed. */
  refreshTree: () => Promise<DocsTree | null>;
  /** Reads the open text file again; images and other files answer `unchanged`. */
  refreshFile: () => Promise<FileRefresh>;
}

function holds(nodes: readonly DocsTreeNode[], path: string): boolean {
  return nodes.some(
    (node) =>
      node.path === path ||
      (node.children !== undefined &&
        path.startsWith(`${node.path}/`) &&
        holds(node.children, path)),
  );
}

/**
 * Follows the project's Docs while the dialog is open. Every notice reads the file list again, so
 * created and deleted files appear and go. The open file is then checked: gone from the list (or
 * answered 404) is `deleted`, and a new revision is `updated`, already shown by the refresh. The
 * notice belongs to the file it names, so another file chosen afterwards shows none.
 */
export function useDocsFollow({
  projectId,
  subscribe,
  path,
  refreshTree,
  refreshFile,
}: UseDocsFollowOptions): DocsNotice | null {
  const [notice, setNotice] = useState<DocsNotice | null>(null);
  const latest = useRef({ path, refreshTree, refreshFile });
  latest.current = { path, refreshTree, refreshFile };

  useEffect(() => {
    if (subscribe === undefined) return;
    return subscribe((changed) => {
      if (changed !== null && changed !== projectId) return;
      void (async () => {
        const tree = await latest.current.refreshTree();
        const open = latest.current.path;
        if (open === null) return;
        const gone = tree !== null && !holds(tree.nodes, open);
        const result: FileRefresh = gone ? 'deleted' : await latest.current.refreshFile();
        if (latest.current.path !== open) return;
        if (result === 'updated' || result === 'deleted')
          setNotice({ kind: result, path: open, at: new Date() });
      })();
    });
  }, [subscribe, projectId]);

  return notice !== null && notice.path === path ? notice : null;
}
