import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ActionDialogData } from '../ActionDialog';
import { epicInk } from '../../lib/epic';
import type { Card } from '../../types';
import { Checkbox } from '../ui/checkbox';
import { Label } from '@/components/ui/label';
import { EditorBody } from './EditorBody';
import { EditorShell } from './EditorShell';
import { DESCRIPTION_LIMIT, countChars, normalizeNewlines, titleProblem } from './limits';
import type { RichMarkdownEditorHandle } from './RichMarkdownEditor';
import { useSaveFlow } from './useSaveFlow';
import { useAttachmentState } from './useAttachmentState';
import { useMultipartRequest } from './useMultipartRequest';
import type { StoredAttachment } from './attachmentTypes';

/**
 * The dialog that edits a draft card: title, body, images and the draft box, saved with one Save.
 * The save runs in order: images, then the body, then the title and the draft. A step that finished
 * stays saved; when a later step fails, the input stays and only the rest is sent again.
 */
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
  const draftId = useId();
  const editor = useRef<RichMarkdownEditorHandle>(null);
  // What the server has: the baseline the unsaved-change check compares with.
  const [saved, setSaved] = useState(() => ({
    title: card.title,
    description: normalizeNewlines(card.description),
    isDraft: card.isDraft,
  }));
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(saved.description);
  const [isDraft, setIsDraft] = useState(card.isDraft);
  const [removed, setRemoved] = useState<string[]>([]);
  const attachmentState = useAttachmentState({
    initial: card.attachments ?? [],
    resolveStoredUrl: (attachment) =>
      projectId
        ? `/api/projects/${projectId}/cards/${card.id}/attachments/${encodeURIComponent(attachment.id)}`
        : '',
  });
  const flow = useSaveFlow({ onClose, onSavingChange });
  const requestId = useMultipartRequest();

  const localAdded = attachmentState.attachments.filter((a) => a.source === 'local');
  const imagesChanged = localAdded.length > 0 || removed.length > 0;
  const titleChanged = title.trim() !== saved.title;
  const draftCleared = !isDraft && saved.isDraft;
  const dirty =
    titleChanged || description !== saved.description || isDraft !== saved.isDraft || imagesChanged;
  const valid = titleProblem(title) === null && countChars(description) <= DESCRIPTION_LIMIT;

  const save = () => {
    if (!valid || flow.busy.current) return;
    void flow.run(async () => {
      // 1. Images: the added ones are sent with their IDs, the removed ones are deleted.
      if (imagesChanged) {
        const remaining: StoredAttachment[] = attachmentState.attachments
          .filter((a) => !removed.includes(a.id))
          .map(({ id, name, mediaType, size, createdAt }) => ({
            id,
            name,
            mediaType,
            size,
            createdAt,
          }));
        await onSubmit({
          requestId: requestId({
            added: localAdded.map((a) => a.id),
            removed,
          }),
          attachments: attachmentState.attachments,
          removedAttachmentIds: removed,
        });
        setRemoved([]);
        attachmentState.reset(remaining);
      }
      // 2. The body, as the editor holds it now (the reader's changes arrive without delay here).
      const text = normalizeNewlines(editor.current?.markdown() ?? description);
      if (text !== saved.description) {
        await onSubmit({ description: text });
        setSaved((current) => ({ ...current, description: text }));
      }
      // 3. The title and the draft flag. Clearing the draft box finalizes the card.
      const nextTitle = title.trim();
      if (nextTitle !== saved.title || draftCleared) {
        await onSubmit({
          ...(nextTitle !== saved.title ? { title: nextTitle } : {}),
          ...(draftCleared ? { finalize: true } : {}),
        });
        setSaved((current) => ({
          ...current,
          title: nextTitle,
          isDraft: draftCleared ? false : current.isDraft,
        }));
      }
    });
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
      onRetry={save}
      onClose={onClose}
      status={dirty ? t('editor.unsaved') : t('editor.noChanges')}
      footerStart={
        <div className="editor__draft">
          <Checkbox
            id={draftId}
            checked={isDraft}
            disabled={flow.saving}
            onCheckedChange={(checked) => setIsDraft(checked === true)}
          />
          <Label htmlFor={draftId}>{t('editor.draft')}</Label>
        </div>
      }
      actions={
        <button
          type="button"
          className="editor__btn editor__btn--primary"
          disabled={flow.saving || !valid || !dirty}
          onClick={save}
        >
          {flow.saving ? t('dialog.saving') : failed ? t('editor.retrySave') : t('editor.save')}
        </button>
      }
    >
      <EditorBody
        title={title}
        onTitleChange={setTitle}
        titleInvalid={titleProblem(title) !== null}
        description={description}
        onDescriptionChange={setDescription}
        editorRef={editor}
        disabled={flow.saving}
        beforeTitle={
          card.epic ? (
            <div className="editor__epic-row">
              <span className="editor__epic-caption">{t('editor.epic')}</span>
              <span
                className="editor__epic-chip"
                style={{ background: card.epic.color, color: epicInk(card.epic.color) }}
                title={card.epic.name}
              >
                {card.epic.id}
              </span>
            </div>
          ) : undefined
        }
        attachmentError={attachmentState.error}
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
