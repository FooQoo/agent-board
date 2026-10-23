import { getJson, projectPath, readToken } from '@/shared/api/http';
import type { ProjectId } from '@/shared/api/contracts';
import type { DocsTreeNode, DocsViewer } from '../ui/shell/DocsFileTree';
import '@/shared/i18n/docs-strings';

export type { DocsTreeNode, DocsViewer };

/** `GET docs/tree`: the entries of the project's docs folder. */
export interface DocsTree {
  nodes: DocsTreeNode[];
  /** The folder held more entries than the list shows. */
  truncated: boolean;
}

/** `GET docs/file`: one Markdown or MDX file, and a revision that changes with its content. */
export interface DocsFile {
  path: string;
  content: string;
  revision: string;
}

const docsPath = (projectId: ProjectId) => `${projectPath(projectId)}/docs`;

export function fetchDocsTree(projectId: ProjectId): Promise<DocsTree> {
  return getJson<DocsTree>(`${docsPath(projectId)}/tree`);
}

export function fetchDocsFile(projectId: ProjectId, path: string): Promise<DocsFile> {
  return getJson<DocsFile>(`${docsPath(projectId)}/file?path=${encodeURIComponent(path)}`);
}

/** The URL of an image in the docs folder (`path` is relative to the docs root). */
export function docsAssetUrl(projectId: ProjectId, path: string): string {
  return `${docsPath(projectId)}/assets?path=${encodeURIComponent(path)}`;
}

/**
 * `POST docs/open`: the server opens the project's docs folder in the computer's file manager, or,
 * given a `path`, that file in the app the computer uses for it. The Docs are edited there.
 */
export async function openDocs(projectId: ProjectId, path?: string): Promise<void> {
  const query = path === undefined ? '' : `?path=${encodeURIComponent(path)}`;
  const response = await fetch(`${docsPath(projectId)}/open${query}`, {
    method: 'POST',
    headers: { 'X-Agboard-Token': readToken() },
  });
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
}
