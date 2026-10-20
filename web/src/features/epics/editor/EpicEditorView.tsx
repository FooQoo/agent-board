import { Button } from '@/shared/ui/button';
import { useTranslation } from 'react-i18next';
import { epicInk } from '../model/epic';
import type { Epic } from '../../../shared/api/contracts';
import { DiscardConfirm } from '../../../shared/ui/editor/DiscardConfirm';
import { EpicDeleteConfirm } from './EpicDeleteConfirm';
import { EditorBody } from '../../../shared/ui/editor/EditorBody';
import { EditorShell } from '../../../shared/ui/editor/EditorShell';
import { CollapsibleSection } from '../../../shared/ui/editor/CollapsibleSection';
import { EpicProgressList, type ProgressTaskRenderer } from './EpicProgressList';
import { EpicColorPicker } from './EpicColorPicker';
import { ListOrderedIcon } from 'lucide-react';
import type { useEpicEditor } from './useEpicEditor';

type EpicEditorState = ReturnType<typeof useEpicEditor>;

export function EpicEditorView({
  epic,
  state,
  onOpenTask,
  onClose,
  renderTask,
}: {
  epic: Epic;
  state: EpicEditorState;
  onOpenTask: (taskId: number) => void;
  onClose: () => void;
  renderTask: ProgressTaskRenderer;
}) {
  const { t } = useTranslation();
  const {
    editor,
    panel,
    setPanel,
    name,
    setName,
    color,
    setColor,
    epicDocument,
    setEpicDocument,
    rows,
    dirty,
    overLimit,
    valid,
    validName,
    saving,
    error,
    run,
    confirmDelete,
    setConfirmDelete,
    deleting,
    deleteError,
    remove,
    requestDelete,
    pendingTask,
    setPendingTask,
    requestOpenTask,
    move,
    attachmentState,
    removeAttachment,
  } = state;

  return (
    <EditorShell
      idLabel={epic.id}
      returnFocusSelector={`[data-epic-label="${epic.id}"]`}
      title={t('epic.editTitle')}
      badge=""
      variant="edit"
      dirty={dirty}
      saving={saving}
      error={error}
      onRetry={run}
      overLimit={overLimit}
      onClose={onClose}
      status={dirty ? t('editor.unsaved') : t('editor.noChanges')}
      actions={
        <>
          <Button
            type="button"
            variant="outline"
            className="epic-delete-button"
            disabled={saving || deleting}
            onClick={requestDelete}
          >
            {t('epic.deleteButton')}
          </Button>
          <Button type="button" disabled={saving || !valid || !dirty} onClick={() => void run()}>
            {saving ? t('dialog.saving') : t('editor.save')}
          </Button>
        </>
      }
    >
      <EditorBody
        title={name}
        onTitleChange={setName}
        titleLabel={t('epic.nameLabel')}
        titleInvalid={!validName}
        description={epicDocument}
        onDescriptionChange={setEpicDocument}
        bodyLabel={t('epic.documentLabel')}
        editorRef={editor}
        disabled={saving}
        asideTop={
          <div className="epic-label-row">
            <span className="editor__epic-caption">{t('epic.label')}</span>
            <span
              className="editor__epic-chip"
              style={{ background: color, color: epicInk(color) }}
              data-epic-label={epic.id}
            >
              {epic.id}
            </span>
            <EpicColorPicker color={color} disabled={saving} onChange={setColor} />
          </div>
        }
        sidebar={
          <CollapsibleSection
            title={t('epic.progressTitle')}
            count={rows.length}
            open={panel === 'progress'}
            onToggle={() => setPanel(panel === 'progress' ? 'images' : 'progress')}
            icon={
              <ListOrderedIcon aria-hidden="true" focusable="false" className="collapsible__icon" />
            }
          >
            <EpicProgressList
              tasks={rows}
              disabled={saving}
              onMove={move}
              onOpenTask={requestOpenTask}
              renderTask={renderTask}
            />
          </CollapsibleSection>
        }
        attachmentsOpen={panel === 'images'}
        onAttachmentsOpenChange={(open) => setPanel(open ? 'images' : 'progress')}
        attachmentNotice={attachmentState.error}
        attachments={attachmentState.attachments}
        onFiles={attachmentState.addFiles}
        onRemoveAttachment={removeAttachment}
      />
      <DiscardConfirm
        open={pendingTask !== null}
        onOpenChange={(open) => {
          if (!open) setPendingTask(null);
        }}
        onKeep={() => setPendingTask(null)}
        onDiscard={() => {
          const taskId = pendingTask;
          setPendingTask(null);
          if (taskId !== null) onOpenTask(taskId);
        }}
        keepLabel={t('editor.backToEdit')}
        discardLabel={t('editor.discardAndMove')}
      />
      <EpicDeleteConfirm
        open={confirmDelete}
        epicId={epic.id}
        dirty={dirty}
        busy={deleting}
        error={deleteError}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => void remove()}
      />
    </EditorShell>
  );
}
