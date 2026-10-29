import type { DocsTreeNode } from '../api/docsApi';

/** Where a link in a document leads. */
export type DocsLinkTarget =
  /** A file of the Docs: the dialog opens it. */
  | { kind: 'file'; path: string }
  /** An `http` or `https` address: a new tab opens it. */
  | { kind: 'external'; url: string }
  /** A relative path with no file of the Docs at its end: the dialog says so. */
  | { kind: 'missing' }
  /** Nothing to do: an anchor in the page, or another scheme such as `mailto:`. */
  | { kind: 'ignore' };

const WEB = /^https?:\/\//i;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
/** The file a link to a folder opens, in this order. */
const FOLDER_FILES = ['README.md', 'index.md', 'README.mdx', 'index.mdx'];

function findNode(nodes: readonly DocsTreeNode[], path: string): DocsTreeNode | null {
  for (const node of nodes) {
    if (node.path === path) return node;
    if (node.children && path.startsWith(`${node.path}/`)) return findNode(node.children, path);
  }
  return null;
}

/**
 * Resolves `href`, written in the document at `docPath` (relative to the Docs root), against the
 * files in `nodes`. A relative path is read from the document's own folder, as in a file browser; a
 * `?query` and a `#fragment` are dropped. A link to a folder opens its README. A path that climbs
 * out of the root, starts with `/`, or names no listed file is `missing`.
 */
export function resolveDocsLink(
  docPath: string,
  href: string,
  nodes: readonly DocsTreeNode[],
): DocsLinkTarget {
  const link = href.trim();
  if (link === '' || link.startsWith('#')) return { kind: 'ignore' };
  if (WEB.test(link)) return { kind: 'external', url: link };
  if (SCHEME.test(link)) return { kind: 'ignore' };
  if (link.startsWith('/')) return { kind: 'missing' };

  let target: string;
  try {
    target = decodeURIComponent(link.replace(/[?#].*$/, ''));
  } catch {
    return { kind: 'missing' };
  }
  const parts = docPath.split('/').slice(0, -1);
  for (const segment of target.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (parts.length === 0) return { kind: 'missing' };
      parts.pop();
    } else {
      parts.push(segment);
    }
  }
  const path = parts.join('/');
  // A link to the current folder itself (`./`) leaves an empty path: the root's files.
  const node: DocsTreeNode | null =
    path === '' ? { name: '', path: '', kind: 'dir', children: [...nodes] } : findNode(nodes, path);
  if (node === null) return { kind: 'missing' };
  if (node.kind !== 'dir') return { kind: 'file', path: node.path };
  for (const name of FOLDER_FILES) {
    const file = (node.children ?? []).find((child) => child.kind !== 'dir' && child.name === name);
    if (file) return { kind: 'file', path: file.path };
  }
  return { kind: 'missing' };
}
