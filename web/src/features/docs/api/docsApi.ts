import { i18n } from '@/shared/i18n';
import { getJson, projectPath, readToken } from '@/shared/api/http';
import type { ProjectId } from '@/shared/api/contracts';
import type { DocsTreeNode } from '../ui/shell/DocsFileTree';
import '@/shared/i18n/docs-strings';

export type { DocsTreeNode };

/** `GET docs/tree`: the entries of the project's docs folder. */
export interface DocsTree {
  nodes: DocsTreeNode[];
  /** The folder held more entries than the list shows. */
  truncated: boolean;
}

/** `GET docs/file`: one Markdown file and the revision to save against. */
export interface DocsFile {
  path: string;
  content: string;
  revision: string;
  readOnly: boolean;
}

/** `PUT docs/file`: the revision the file has now. */
export interface DocsSaved {
  path: string;
  revision: string;
}

/** A rejected save. `currentRevision` is set for a revision conflict. */
export class DocsWriteError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
    readonly currentRevision: string | null = null,
  ) {
    super(message);
  }

  get conflict(): boolean {
    return this.code === 'docs_revision_conflict';
  }
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

export async function saveDocsFile(
  projectId: ProjectId,
  input: { path: string; content: string; expectedRevision: string },
): Promise<DocsSaved> {
  const response = await fetch(`${docsPath(projectId)}/file`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-Agboard-Token': readToken(),
      'X-Agboard-Language': i18n.resolvedLanguage === 'ja' ? 'ja' : 'en',
    },
    body: JSON.stringify(input),
  });
  let body: {
    path?: string;
    revision?: string;
    currentRevision?: string;
    error?: { code?: string; reason?: string; currentRevision?: string };
  } = {};
  try {
    body = await response.json();
  } catch {
    // The body was not JSON.
  }
  if (!response.ok || typeof body.revision !== 'string') {
    throw new DocsWriteError(
      body.error?.reason ?? `Request failed (${response.status})`,
      response.status,
      body.error?.code ?? null,
      body.currentRevision ?? body.error?.currentRevision ?? null,
    );
  }
  return { path: body.path ?? input.path, revision: body.revision };
}

/**
 * The sentence for a rejected save whose code has its own, or null for any other failure (which
 * gets the general one). The server's reason is not shown.
 */
export function saveErrorMessage(t: (key: string) => string, error: unknown): string | null {
  if (!(error instanceof DocsWriteError)) return null;
  switch (error.code) {
    case 'docs_read_only':
      return t('docsDocument.readOnly');
    default:
      return null;
  }
}
