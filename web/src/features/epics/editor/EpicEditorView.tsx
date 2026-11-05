import { Button } from '@/shared/ui/button';
import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';
import { epicInk } from '../model/epic';
import type { Epic } from '../../../shared/api/contracts';
import { DiscardConfirm } from '../../../shared/ui/editor/DiscardConfirm';
import { EditorBody } from '../../../shared/ui/editor/EditorBody';
import { EPIC_DOCUMENT_LIMIT } from '../../../shared/ui/editor/limits';
import { EditorShell } from '../../../shared/ui/editor/EditorShell';
import { EditorStatus, type EditorStatusLine } from '../../../shared/ui/editor/EditorStatus';
import { StateChip } from '../../../shared/ui/editor/StateChip';
import { CollapsibleSection } from '../../../shared/ui/editor/CollapsibleSection';
import { EpicProgressList, type ProgressTaskRenderer } from './EpicProgressList';
import { EpicColorPicker } from './EpicColorPicker';
import { ListOrderedIcon } from 'lucide-react';
import type { useEpicEditor } from './useEpicEditor';

type EpicEditorState = ReturnType<typeof useEpicEditor>;

/** The hour and minute of the time the screen last followed a change. */
function clock(time: Date, language: string): string {
  return time.toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit' });
}

export function EpicEditorView({
  epic,
  state,
  renderTask,
}: {
  epic: Epic;
  state: EpicEditorState;
  renderTask: ProgressTaskRenderer;
}) {
  const { t, i18n } = useTranslation();
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
    canSave,
    finalizePending,
    problem,
    retryLock,
    locked,
    updatedAt,
    version,
    discardAndOpenTask,
    close,
    validName,
    saving,
    error,
    run,
    pendingTask,
    setPendingTask,
    requestOpenTask,
    move,
    attachmentState,
    removeAttachment,
  } = state;

  const lines: EditorStatusLine[] =
    problem === 'conflict'
      ? [
          { tone: 'error', text: t('editor.conflictEpic') },
          { tone: 'info', text: t('editor.unsaved') },
        ]
      : (dirty || finalizePending) && locked
        ? [{ tone: 'lock', text: t('editor.lockedEpic') }]
        : dirty
          ? [{ tone: 'info', text: t('editor.unsaved') }]
          : updatedAt !== null
            ? [
                {
                  tone: 'info',
                  text: t('editor.updatedAt', { time: clock(updatedAt, i18n.language) }),
                },
              ]
            : [];
  const status: ReactNode =
    lines.length > 0 ? <EditorStatus lines={lines} /> : t('editor.noChanges');
  // A draft that could not be entered says so in the error band, with a retry for the lock.
  const lockFailed = problem === 'failed' || problem === 'running';

  return (
    <EditorShell
      idLabel={epic.id}
      returnFocusSelector={`[data-epic-label="${epic.id}"]`}
      title={t('editor.previewEpicTitle')}
      badge={locked ? <StateChip kind="draft" /> : ''}
      variant="edit"
      dirty={dirty}
      saving={saving}
      error={error ?? (lockFailed ? t('editor.saveFailed') : null)}
      onRetry={error === null && lockFailed ? retryLock : run}
      overLimit={overLimit}
      onClose={close}
      closeLabel={dirty ? undefined : t('dialog.close')}
      status={status}
      actions={
        <Button type="button" disabled={saving || !canSave} onClick={() => void run()}>
          {saving ? t('dialog.saving') : t('editor.save')}
        </Button>
      }
    >
      <EditorBody
        key={version}
        limit={EPIC_DOCUMENT_LIMIT}
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
          if (taskId !== null) discardAndOpenTask(taskId);
        }}
        keepLabel={t('editor.backToEdit')}
        discardLabel={t('editor.discardAndMove')}
      />
    </EditorShell>
  );
}
