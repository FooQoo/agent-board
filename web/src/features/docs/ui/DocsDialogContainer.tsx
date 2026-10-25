import { SquarePenIcon } from 'lucide-react';
import { type ReactNode, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProjectId } from '@/shared/api/contracts';
import { splitFrontmatter } from '@/shared/markdown/frontmatter';
import { resolveRelativeImage } from '@/shared/markdown/resolveRelativeImage';
import { RichMarkdownEditor } from '@/shared/rich-editor/RichMarkdownEditor';
import { Button } from '@/shared/ui/button';
import { docsAssetUrl, openDocs } from '../api/docsApi';
import {
  type DocsChangeSubscription,
  type DocsNotice,
  useDocsFollow,
} from '../model/useDocsFollow';
import { useDocsTree } from '../model/useDocsTree';
import { type FileRefresh, useDocument } from '../model/useDocument';
import { DocumentPane } from './document/DocumentPane';
import { FileViewer } from './document/FileViewer';
import { MdxFrame } from './document/MdxFrame';
import { DOCS_LIST_WIDTH, DocsDialogView } from './shell/DocsDialogView';
import type { DocsTreeNode, DocsViewer } from './shell/DocsFileTree';
import '@/shared/i18n/docs-strings';

/** How the docs show the file at `path`; a path the tree does not hold counts as Markdown. */
function viewerOf(nodes: readonly DocsTreeNode[], path: string): DocsViewer {
  for (const node of nodes) {
    if (node.path === path) return node.viewer ?? 'markdown';
    if (node.children && path.startsWith(`${node.path}/`)) return viewerOf(node.children, path);
  }
  return 'markdown';
}

const ignoreChange = () => {};

export interface DocsDialogContainerProps {
  projectId: ProjectId;
  onClose: () => void;
  /** Notices that the project's Docs changed on disk; without it the dialog does not follow them. */
  subscribeChanges?: DocsChangeSubscription;
}

/**
 * The docs dialog with its data. It only shows the files: the list is fetched when the dialog
 * opens, and a file each time it is chosen, with nothing kept between choices. While the dialog is
 * open it follows the files on disk: the list is read again on every change, and the open file is
 * shown again when it changed, with a notice at the right of the footer. Files are edited in the
 * user's own editor, which "Open in editor" starts. The project is a prop of the instance: give
 * another project a new instance (a `key`) to start from nothing.
 */
export function DocsDialogContainer({
  projectId,
  onClose,
  subscribeChanges,
}: DocsDialogContainerProps) {
  const { t, i18n } = useTranslation();
  const tree = useDocsTree(projectId);
  // The chosen file and how it shows, fixed when it is chosen: a file deleted afterwards keeps it.
  const [selected, setSelected] = useState<{ path: string; viewer: DocsViewer } | null>(null);
  const [listWidth, setListWidth] = useState<number>(DOCS_LIST_WIDTH.default);
  const [openFolderFailed, setOpenFolderFailed] = useState(false);
  const [openFileFailed, setOpenFileFailed] = useState<string | null>(null);
  // Raised when an open image may have changed, so it is fetched again.
  const [imageVersion, setImageVersion] = useState(0);
  const selectedPath = selected?.path ?? null;
  const viewer = selected?.viewer ?? 'markdown';
  const isMdx = selectedPath?.toLowerCase().endsWith('.mdx') === true;
  const document = useDocument(projectId, viewer === 'markdown' ? selectedPath : null);

  const refreshFile = useCallback(async (): Promise<FileRefresh> => {
    if (viewer === 'image') setImageVersion((value) => value + 1);
    if (viewer !== 'markdown') return 'unchanged';
    return document.refresh();
  }, [viewer, document.refresh]);
  const notice = useDocsFollow({
    projectId,
    subscribe: subscribeChanges,
    path: selectedPath,
    refreshTree: tree.refresh,
    refreshFile,
  });

  const selectFile = useCallback(
    (path: string) => setSelected({ path, viewer: viewerOf(tree.nodes, path) }),
    [tree.nodes],
  );

  const openFolder = useCallback(() => {
    setOpenFolderFailed(false);
    openDocs(projectId).catch(() => setOpenFolderFailed(true));
  }, [projectId]);

  const openFile = useCallback(() => {
    if (selectedPath === null) return;
    setOpenFileFailed(null);
    openDocs(projectId, selectedPath).catch(() => setOpenFileFailed(selectedPath));
  }, [projectId, selectedPath]);

  const file = document.file;
  const split = useMemo(() => splitFrontmatter(file?.content ?? ''), [file]);
  const resolveImage = useCallback(
    (src: string) => {
      if (file === null) return null;
      const resolved = resolveRelativeImage(file.path, src);
      return resolved === src ? null : docsAssetUrl(projectId, resolved);
    },
    [file, projectId],
  );

  const paneState =
    document.status === 'ready' ? 'ready' : document.status === 'error' ? 'error' : 'loading';
  const noticeText = (shown: DocsNotice) => {
    const time = shown.at.toLocaleTimeString(i18n.resolvedLanguage, {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    return shown.kind === 'updated'
      ? t('docs.fileUpdated', { time })
      : t('docs.fileDeleted', { time });
  };
  const failed = openFileFailed !== null && openFileFailed === selectedPath;

  let body: ReactNode = null;
  if (selectedPath !== null && viewer !== 'markdown') {
    const src = docsAssetUrl(projectId, selectedPath);
    body = (
      <DocumentPane
        state="ready"
        kindLabel={viewer === 'image' ? t('docsDocument.kindImage') : t('docsDocument.kindOther')}
      >
        <FileViewer
          kind={viewer}
          name={selectedPath.split('/').at(-1) ?? selectedPath}
          src={
            viewer === 'image' ? (imageVersion === 0 ? src : `${src}&v=${imageVersion}`) : undefined
          }
        />
      </DocumentPane>
    );
  } else if (selectedPath !== null) {
    body = (
      <DocumentPane
        state={paneState}
        frontmatter={split.frontmatter}
        onRetry={document.reload}
        kindLabel={isMdx ? t('docsDocument.kindMdx') : undefined}
      >
        {file !== null &&
          (isMdx ? (
            <MdxFrame source={split.body} />
          ) : (
            <RichMarkdownEditor
              key={document.loadId}
              value={split.body}
              onChange={ignoreChange}
              aria-label={file.path}
              disabled
              resolveImage={resolveImage}
            />
          ))}
      </DocumentPane>
    );
  }

  return (
    <DocsDialogView
      status={tree.status}
      tree={tree.nodes}
      selectedPath={selectedPath}
      onSelectFile={selectFile}
      rootPath={`shared/projects/${projectId}/docs/`}
      onRetry={tree.reload}
      onOpenFolder={openFolder}
      openFolderFailed={openFolderFailed}
      listWidth={listWidth}
      onResize={setListWidth}
      actions={
        <>
          {failed ? (
            <span className="docs-dialog__notice" data-kind="failed" role="alert">
              {t('docs.openFileFailed')}
            </span>
          ) : notice !== null ? (
            <span className="docs-dialog__notice" data-kind={notice.kind} role="status">
              {noticeText(notice)}
            </span>
          ) : null}
          <Button
            type="button"
            variant="outline"
            className="docs-dialog__open-file"
            onClick={openFile}
          >
            <SquarePenIcon aria-hidden="true" />
            {t('docs.openInEditor')}
          </Button>
        </>
      }
      onClose={onClose}
    >
      {body}
    </DocsDialogView>
  );
}
