import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProjectId } from '@/shared/api/contracts';
import { resolveRelativeImage } from '@/shared/markdown/resolveRelativeImage';
import { RichMarkdownEditor } from '@/shared/rich-editor/RichMarkdownEditor';
import { SaveIcon } from 'lucide-react';
import { Button } from '@/shared/ui/button';
import { DiscardConfirm } from '@/shared/ui/editor/DiscardConfirm';
import { docsAssetUrl, type DocsFile } from '../api/docsApi';
import { useDocsTree } from '../model/useDocsTree';
import { useDocument } from '../model/useDocument';
import { useDocumentEditor } from '../model/useDocumentEditor';
import { DocumentPane } from './document/DocumentPane';
import { FileViewer } from './document/FileViewer';
import { DOCS_LIST_WIDTH, DocsDialogView } from './shell/DocsDialogView';
import type { DocsTreeNode, DocsViewer } from './shell/DocsFileTree';
import '@/shared/i18n/docs-strings';

/** Stands in for the file while none is loaded, so the editor's hook always has one. */
const NO_FILE: DocsFile = { path: '', content: '', revision: '', readOnly: true };

/** How the docs show the file at `path`; a path the tree does not hold counts as Markdown. */
function viewerOf(nodes: readonly DocsTreeNode[], path: string | null): DocsViewer {
  for (const node of nodes) {
    if (node.path === path) return node.viewer ?? 'markdown';
    if (node.children && path?.startsWith(`${node.path}/`)) return viewerOf(node.children, path);
  }
  return 'markdown';
}

export interface DocsDialogContainerProps {
  projectId: ProjectId;
  onClose: () => void;
}

/**
 * The docs dialog with its data: the file list (fetched once, when the dialog opens), the chosen
 * file (fetched when it is chosen), and its edit, save and conflict handling. The project is a
 * prop of the instance: give another project a new instance (a `key`) to start from nothing.
 */
export function DocsDialogContainer({ projectId, onClose }: DocsDialogContainerProps) {
  const { t } = useTranslation();
  const tree = useDocsTree(projectId);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  // A file chosen while the open one has unsaved changes, waiting for the answer.
  const [pendingPath, setPendingPath] = useState<string | null>(null);
  const [listWidth, setListWidth] = useState<number>(DOCS_LIST_WIDTH.default);
  const viewer = useMemo(() => viewerOf(tree.nodes, selectedPath), [tree.nodes, selectedPath]);
  // Only a Markdown file has text to fetch, edit or save.
  const document = useDocument(projectId, viewer === 'markdown' ? selectedPath : null);
  const editor = useDocumentEditor({ projectId, file: document.file ?? NO_FILE });

  const selectFile = useCallback(
    (path: string) => {
      if (path === selectedPath) return;
      if (editor.dirty) setPendingPath(path);
      else setSelectedPath(path);
    },
    [selectedPath, editor.dirty],
  );

  const file = document.file;
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

  return (
    <>
      <DocsDialogView
        status={tree.status}
        tree={tree.nodes}
        selectedPath={selectedPath}
        onSelectFile={selectFile}
        rootPath={`shared/projects/${projectId}/docs/`}
        onRetry={tree.reload}
        listWidth={listWidth}
        onResize={setListWidth}
        dirty={editor.dirty}
        saving={editor.saving}
        error={editor.error}
        footerStatus={
          editor.conflict
            ? t('docs.notSaved')
            : editor.dirty
              ? t('editor.unsaved')
              : t('editor.noChanges')
        }
        footerWarn={editor.conflict || editor.dirty}
        actions={
          <Button
            type="button"
            className="docs-dialog__save"
            disabled={!editor.canSave}
            onClick={() => void editor.save()}
          >
            <SaveIcon aria-hidden="true" />
            {t('editor.save')}
          </Button>
        }
        onClose={onClose}
      >
        {selectedPath !== null && viewer !== 'markdown' ? (
          <DocumentPane
            state="ready"
            kindLabel={
              viewer === 'image' ? t('docsDocument.kindImage') : t('docsDocument.kindOther')
            }
          >
            <FileViewer
              kind={viewer}
              name={selectedPath.split('/').at(-1) ?? selectedPath}
              src={viewer === 'image' ? docsAssetUrl(projectId, selectedPath) : undefined}
            />
          </DocumentPane>
        ) : (
          <DocumentPane
            state={paneState}
            frontmatter={editor.frontmatter}
            readOnly={file?.readOnly ?? false}
            conflict={editor.conflict}
            conflictBusy={editor.saving}
            onReload={document.reload}
            onOverwrite={() => void editor.overwrite()}
            onRetry={document.reload}
          >
            {file !== null && (
              <RichMarkdownEditor
                key={document.loadId}
                value={editor.body}
                onChange={editor.onChange}
                aria-label={file.path}
                disabled={file.readOnly || editor.saving}
                resolveImage={resolveImage}
              />
            )}
          </DocumentPane>
        )}
      </DocsDialogView>
      <DiscardConfirm
        open={pendingPath !== null}
        onOpenChange={(open) => !open && setPendingPath(null)}
        onKeep={() => setPendingPath(null)}
        discardLabel={t('editor.discardAndMove')}
        onDiscard={() => {
          setSelectedPath(pendingPath);
          setPendingPath(null);
        }}
      />
    </>
  );
}
