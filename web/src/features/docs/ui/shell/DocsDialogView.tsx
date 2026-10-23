import { FolderOpenIcon, FolderTreeIcon } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { EditorShell } from '@/shared/ui/editor/EditorShell';
import { ResizeHandle } from '@/shared/ui/resize-handle/ResizeHandle';
import { DocsFileTree, type DocsTreeNode } from './DocsFileTree';
import { DocsPlaceholder } from './DocsPlaceholder';
import './docs-shell.css';
import '@/shared/i18n/docs-strings';

/** The width of the file list in pixels: where it starts, and the least and most it may take. */
export const DOCS_LIST_WIDTH = { default: 280, min: 200, max: 480 } as const;

/** At this width and below the two panes become two screens. */
const COMPACT_QUERY = '(max-width: 640px)';

function useCompactScreen(): boolean {
  const [compact, setCompact] = useState(() => window.matchMedia(COMPACT_QUERY).matches);
  useEffect(() => {
    const query = window.matchMedia(COMPACT_QUERY);
    const update = () => setCompact(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return compact;
}

export interface DocsDialogViewProps {
  /** The file list: still loading, failed to load, or loaded (an empty list means no docs). */
  status: 'loading' | 'error' | 'ready';
  tree: readonly DocsTreeNode[];
  /** The open file, or null while none is chosen. */
  selectedPath: string | null;
  onSelectFile: (path: string) => void;
  /** The folder the docs live in, shown when the project has none. */
  rootPath?: string;
  /** Opens the docs folder in the computer's file manager; the button shows only with it, and not on the phone. */
  onOpenFolder?: () => void;
  /** The folder could not be opened. */
  openFolderFailed?: boolean;
  /** Retry of a failed file list. */
  onRetry?: () => void;
  /** The width of the file list in pixels; the view keeps a drag within DOCS_LIST_WIDTH. */
  listWidth: number;
  onResize: (width: number) => void;
  /** The body pane, shown once a file is chosen. */
  children?: ReactNode;
  /** What sits at the right of the footer, before Close: a notice and the file's buttons. Without a
   * chosen file there is none. */
  actions?: ReactNode;
  onClose: () => void;
  /** Force the phone layout (list and body as two screens) on or off; follows the window by default. */
  compact?: boolean;
  /** Which screen the phone layout shows; the body once a file is chosen unless told otherwise. */
  phonePane?: 'list' | 'body';
}

/** The header title: "Docs", then the folders and the file of the open one as a path. */
function DocsTitle({ path }: { path: string | null }) {
  const { t } = useTranslation();
  const segments = path === null ? [] : path.split('/').filter((segment) => segment !== '');
  if (segments.length === 0) return <>{t('docs.title')}</>;
  return (
    <nav className="docs-crumbs">
      <span className="docs-crumbs__root">{t('docs.title')}</span>
      {segments.map((segment, index) => (
        <span key={`${index}:${segment}`} className="docs-crumbs__item">
          <span className="docs-crumbs__sep" aria-hidden="true">
            /
          </span>
          <span
            className={index === segments.length - 1 ? 'docs-crumbs__file' : 'docs-crumbs__folder'}
            aria-current={index === segments.length - 1 ? 'page' : undefined}
          >
            {segment}
          </span>
        </span>
      ))}
    </nav>
  );
}

/**
 * The docs dialog: the shared editor frame with the file list on the left and the document in the
 * center. The frame, header and footer are the editor shell's; nothing here is edited.
 */
export function DocsDialogView({
  status,
  tree,
  selectedPath,
  onSelectFile,
  rootPath = '',
  onOpenFolder,
  openFolderFailed = false,
  onRetry,
  listWidth,
  onResize,
  children,
  actions,
  onClose,
  compact,
  phonePane,
}: DocsDialogViewProps) {
  const { t } = useTranslation();
  const windowCompact = useCompactScreen();
  const phone = compact ?? windowCompact;
  const empty = status === 'ready' && tree.length === 0;
  const hasFile = selectedPath !== null && !empty;
  // The phone's Files button asks for the list while a file is open; choosing a file ends it.
  const [listRequested, setListRequested] = useState(false);
  const pane = phonePane ?? (listRequested ? 'list' : hasFile || empty ? 'body' : 'list');
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);

  const clamp = (width: number) =>
    Math.min(DOCS_LIST_WIDTH.max, Math.max(DOCS_LIST_WIDTH.min, Math.round(width)));
  const startDrag = (clientX: number) => {
    drag.current = { startX: clientX, startWidth: listWidth };
  };
  const moveDrag = (clientX: number) => {
    if (drag.current === null) return;
    onResize(clamp(drag.current.startWidth + clientX - drag.current.startX));
  };
  const endDrag = () => {
    drag.current = null;
  };

  let list: ReactNode;
  if (status === 'loading') list = <p className="docs-tree__empty">{t('docs.treeLoading')}</p>;
  else if (status === 'error')
    list = (
      <div className="docs-tree__failure" role="alert">
        <p>{t('docs.treeError')}</p>
        {onRetry && (
          <Button type="button" variant="outline" size="s" onClick={onRetry}>
            {t('editor.retry')}
          </Button>
        )}
      </div>
    );
  else
    list = (
      <DocsFileTree
        nodes={tree}
        selectedPath={selectedPath}
        onSelectFile={(path) => {
          setListRequested(false);
          onSelectFile(path);
        }}
      />
    );

  let center: ReactNode;
  if (empty) center = <DocsPlaceholder kind="noDocs" rootPath={rootPath} />;
  else if (hasFile) center = children;
  else center = <DocsPlaceholder kind="noFile" />;

  return (
    <EditorShell
      title={<DocsTitle path={hasFile && pane === 'body' ? selectedPath : null} />}
      badge=""
      variant="edit"
      className="docs-dialog"
      dialogData={{
        'data-compact': phone ? 'true' : 'false',
        'data-pane': pane,
      }}
      closeLabel={t('dialog.close')}
      dirty={false}
      saving={false}
      error={null}
      onClose={onClose}
      status=""
      actions={
        hasFile ? (
          <>
            {phone && (
              <Button
                type="button"
                variant="outline"
                className="docs-dialog__files"
                onClick={() => setListRequested(true)}
              >
                <FolderTreeIcon aria-hidden="true" />
                {t('docs.files')}
              </Button>
            )}
            {actions}
          </>
        ) : null
      }
    >
      <div className="docs-dialog__body">
        <div
          className="docs-dialog__list"
          style={phone ? undefined : { width: listWidth }}
          data-hidden={phone && pane === 'body' ? 'true' : undefined}
        >
          {phone && !hasFile && !empty && status === 'ready' && (
            <>
              <DocsPlaceholder kind="noFile" compact />
              <div className="docs-dialog__rule" aria-hidden="true" />
            </>
          )}
          {!phone && (
            <div className="docs-dialog__list-head">
              <h3 className="docs-dialog__list-heading">{t('docs.files')}</h3>
              {onOpenFolder && (
                <button
                  type="button"
                  className="docs-dialog__open-folder"
                  aria-label={t('docs.openFolder')}
                  title={t('docs.openFolder')}
                  onClick={onOpenFolder}
                >
                  <FolderOpenIcon aria-hidden="true" />
                </button>
              )}
            </div>
          )}
          {!phone && openFolderFailed && (
            <p className="docs-dialog__open-error" role="alert">
              {t('docs.openFolderFailed')}
            </p>
          )}
          <div className="docs-dialog__list-scroll">{list}</div>
          {!phone && (
            <div className="docs-dialog__resize">
              <ResizeHandle
                label={t('docs.resize')}
                startDrag={startDrag}
                moveDrag={moveDrag}
                endDrag={endDrag}
              />
            </div>
          )}
        </div>
        <div
          className="docs-dialog__center"
          data-hidden={phone && pane === 'list' ? 'true' : undefined}
        >
          {center}
        </div>
      </div>
    </EditorShell>
  );
}
