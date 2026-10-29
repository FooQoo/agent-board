import {
  ChevronDownIcon,
  ChevronRightIcon,
  FileIcon,
  FileTextIcon,
  ImageIcon,
  FolderIcon,
  FolderOpenIcon,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import './docs-shell.css';
import '@/shared/i18n/docs-strings';

/** How the docs show a file: Markdown is edited, an image is displayed, any other is only listed. */
export type DocsViewer = 'markdown' | 'image' | 'other';

/** One entry of the tree the docs API returns: a folder with its entries, or a file. */
export interface DocsTreeNode {
  name: string;
  /** The path from the docs root, with `/` between the parts. */
  path: string;
  kind: 'dir' | 'file';
  /** How a file is shown; a folder has none. */
  viewer?: DocsViewer;
  children?: DocsTreeNode[];
}

export interface DocsFileTreeProps {
  nodes: readonly DocsTreeNode[];
  /** The path of the open file, or null while none is chosen. */
  selectedPath: string | null;
  onSelectFile: (path: string) => void;
}

/** The files of the docs, as folders that open and close. Every folder starts open. */
export function DocsFileTree({ nodes, selectedPath, onSelectFile }: DocsFileTreeProps) {
  const { t } = useTranslation();
  const [closed, setClosed] = useState<ReadonlySet<string>>(() => new Set());
  const treeRef = useRef<HTMLDivElement>(null);

  // A file chosen from elsewhere (a link in a document) may sit in a folder the reader closed:
  // open the folders above it, then bring its row into view.
  const [revealed, setRevealed] = useState(selectedPath);
  if (selectedPath !== revealed) {
    setRevealed(selectedPath);
    if (selectedPath !== null && [...closed].some((path) => selectedPath.startsWith(`${path}/`)))
      setClosed(new Set([...closed].filter((path) => !selectedPath.startsWith(`${path}/`))));
  }
  useEffect(() => {
    if (selectedPath === null) return;
    treeRef.current?.querySelector('[aria-current="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [selectedPath]);

  if (nodes.length === 0) return <p className="docs-tree__empty">{t('docs.noFiles')}</p>;

  const toggle = (path: string) =>
    setClosed((current) => {
      const next = new Set(current);
      if (!next.delete(path)) next.add(path);
      return next;
    });

  const rows = (list: readonly DocsTreeNode[], depth: number): React.ReactNode =>
    list.map((node) => {
      const indent = { paddingLeft: 8 + 20 * depth };
      if (node.kind === 'dir') {
        const open = !closed.has(node.path);
        return (
          <div key={node.path} role="none">
            <button
              type="button"
              role="treeitem"
              aria-level={depth + 1}
              aria-expanded={open}
              title={node.name}
              className="docs-tree__row"
              style={indent}
              onClick={() => toggle(node.path)}
            >
              {open ? (
                <ChevronDownIcon aria-hidden="true" className="docs-tree__chevron" />
              ) : (
                <ChevronRightIcon aria-hidden="true" className="docs-tree__chevron" />
              )}
              {open ? (
                <FolderOpenIcon aria-hidden="true" className="docs-tree__icon" />
              ) : (
                <FolderIcon aria-hidden="true" className="docs-tree__icon" />
              )}
              <span className="docs-tree__name">{node.name}</span>
            </button>
            {open && node.children && rows(node.children, depth + 1)}
          </div>
        );
      }
      const selected = node.path === selectedPath;
      return (
        <button
          key={node.path}
          type="button"
          role="treeitem"
          aria-level={depth + 1}
          aria-current={selected ? 'true' : undefined}
          title={node.name}
          className="docs-tree__row docs-tree__row--file"
          style={indent}
          onClick={() => onSelectFile(node.path)}
        >
          <span className="docs-tree__indent" aria-hidden="true" />
          {node.viewer === 'image' ? (
            <ImageIcon aria-hidden="true" className="docs-tree__icon" />
          ) : node.viewer === 'other' ? (
            <FileIcon aria-hidden="true" className="docs-tree__icon" />
          ) : (
            <FileTextIcon aria-hidden="true" className="docs-tree__icon" />
          )}
          <span className="docs-tree__name">{node.name}</span>
        </button>
      );
    });

  return (
    <div ref={treeRef} role="tree" aria-label={t('docs.fileTree')} className="docs-tree">
      {rows(nodes, 0)}
    </div>
  );
}
