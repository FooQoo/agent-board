import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ActionDialogData } from '../ActionDialog';
import type { Card } from '../../types';
import { EditorBody } from './EditorBody';
import { EditorShell } from './EditorShell';
import { DESCRIPTION_LIMIT, countChars, normalizeNewlines, titleProblem } from './limits';
import { useSaveFlow } from './useSaveFlow';
import { useAttachmentState } from './useAttachmentState';

/** The dialog that edits the title and description of a draft; it saves, or saves and finalizes. */
export function EditDialog({
  card,
  onClose,
  onSavingChange,
  onSubmit,
  projectId,
}: {
  card: Card;
  onClose: () => void;
  onSavingChange?: (saving: boolean) => void;
  onSubmit: (data: ActionDialogData) => Promise<void>;
  projectId?: string;
}) {
  const { t } = useTranslation();
  const [initialDescription] = useState(() => normalizeNewlines(card.description));
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(initialDescription);
  const [lastFinalize, setLastFinalize] = useState(false);
  const [removed, setRemoved] = useState<string[]>([]);
  const attachmentState = useAttachmentState({
    initial: card.attachments ?? [],
    resolveStoredUrl: (attachment) =>
      projectId
        ? `/api/projects/${projectId}/cards/${card.id}/attachments/${encodeURIComponent(attachment.id)}`
        : '',
  });
  const flow = useSaveFlow({ onClose, onSavingChange });

  const titleChanged = title.trim() !== card.title;
  const descriptionChanged = description !== initialDescription;
  const attachmentChanged =
    attachmentState.attachments.some((a) => a.source === 'local') ||
    removed.length > 0 ||
    attachmentState.attachments.length !== (card.attachments ?? []).length;
  const dirty = titleChanged || descriptionChanged || attachmentChanged;
  const valid = titleProblem(title) === null && countChars(description) <= DESCRIPTION_LIMIT;

  const save = (finalize: boolean) => {
    if (!valid || flow.busy.current) return;
    setLastFinalize(finalize);
    void flow.run(() =>
      onSubmit({
        ...(titleChanged ? { title: title.trim() } : {}),
        ...(descriptionChanged ? { description } : {}),
        ...(attachmentChanged
          ? { attachments: attachmentState.attachments, removedAttachmentIds: removed }
          : {}),
        ...(finalize ? { finalize: true } : {}),
      }),
    );
  };

  const failed = flow.error !== null;
  return (
    <EditorShell
      cardId={card.id}
      title={card.title}
      badge={t('editor.editingDraft')}
      variant="edit"
      dirty={dirty}
      saving={flow.saving}
      error={flow.error}
      onRetry={() => save(lastFinalize)}
      onClose={onClose}
      status={dirty ? t('editor.unsaved') : undefined}
      actions={
        <>
          <button
            type="button"
            className="editor__btn editor__btn--secondary"
            disabled={flow.saving || !valid || !dirty}
            onClick={() => save(false)}
          >
            {flow.saving && !lastFinalize
              ? t('dialog.saving')
              : failed
                ? t('editor.retrySave')
                : t('editor.save')}
          </button>
          <button
            type="button"
            className="editor__btn editor__btn--primary"
            disabled={flow.saving || !valid}
            onClick={() => save(true)}
          >
            {flow.saving && lastFinalize ? t('dialog.saving') : t('editor.saveAndFinalize')}
          </button>
        </>
      }
    >
      <EditorBody
        title={title}
        onTitleChange={setTitle}
        titleInvalid={titleProblem(title) !== null}
        description={description}
        onDescriptionChange={setDescription}
        disabled={flow.saving}
        attachments={attachmentState.attachments}
        onFiles={attachmentState.addFiles}
        onRemoveAttachment={(id) => {
          const item = attachmentState.attachments.find((attachment) => attachment.id === id);
          if (item?.source === 'stored')
            setRemoved((current) => (current.includes(id) ? current : [...current, id]));
          attachmentState.remove(id);
        }}
      />
    </EditorShell>
  );
}
