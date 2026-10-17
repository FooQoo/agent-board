import { Button } from '@/components/ui/button';
import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ActionDialogData } from '../ActionDialog';
import { epicInk } from '../../lib/epic';
import type { AcceptanceItem, Task } from '../../types';
import { acceptanceProblem } from '../../lib/acceptance';
import { ConditionsDock } from '../acceptance/ConditionsDock';
import { ConditionsLink } from '../acceptance/ConditionsLink';
import { EditorBody, useOverLimit } from './EditorBody';
import { EditorShell } from './EditorShell';
import { DESCRIPTION_LIMIT, countChars, normalizeNewlines, titleProblem } from './limits';
import type { RichMarkdownEditorHandle } from './RichMarkdownEditor';
import { useSaveFlow } from './useSaveFlow';
import { useAttachmentState } from './useAttachmentState';
import { useMultipartRequest } from './useMultipartRequest';
import type { StoredAttachment } from './attachmentTypes';

/**
 * The dialog that edits a draft card: title, body and images, saved with one Save.
 * The save runs in order: images, then the body, then the title and the draft. A step that finished
 * stays saved; when a later step fails, the input stays and only the rest is sent again.
 */
export function EditDialog({
  task,
  onClose,
  onSavingChange,
  onSubmit,
  projectId,
}: {
  task: Task;
  onClose: () => void;
  onSavingChange?: (saving: boolean) => void;
  onSubmit: (data: ActionDialogData) => Promise<void>;
  projectId?: string;
}) {
  const { t } = useTranslation();
  const editor = useRef<RichMarkdownEditorHandle>(null);
  // A card whose frontmatter cannot be read is edited as its whole text, as it was before.
  const whole = task.acceptanceError;
  // What the server has: the baseline the unsaved-change check compares with.
  const [saved, setSaved] = useState(() => ({
    title: task.title,
    description: normalizeNewlines(whole ? task.description : task.body),
    acceptance: task.acceptance,
  }));
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(saved.description);
  const [conditions, setConditions] = useState<AcceptanceItem[]>(task.acceptance);
  const conditionsId = useId();
  const [removed, setRemoved] = useState<string[]>([]);
  const attachmentState = useAttachmentState({
    initial: task.attachments ?? [],
    resolveStoredUrl: (attachment) =>
      projectId
        ? `/api/projects/${projectId}/tasks/${task.id}/attachments/${encodeURIComponent(attachment.id)}`
        : '',
  });
  const flow = useSaveFlow({ onClose, onSavingChange });
  const requestId = useMultipartRequest();

  const localAdded = attachmentState.attachments.filter((a) => a.source === 'local');
  const imagesChanged = localAdded.length > 0 || removed.length > 0;
  const titleChanged = title.trim() !== saved.title;
  const conditionsChanged =
    !whole && JSON.stringify(conditions) !== JSON.stringify(saved.acceptance);
  const dirty =
    titleChanged || description !== saved.description || conditionsChanged || imagesChanged;
  const overLimit = useOverLimit(description);
  const valid =
    titleProblem(title) === null &&
    countChars(description) <= DESCRIPTION_LIMIT &&
    (whole || acceptanceProblem(conditions) === null);

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
      // The body and the conditions go in one request, so the server writes them as one file.
      const text = normalizeNewlines(editor.current?.markdown() ?? description);
      if (whole ? text !== saved.description : text !== saved.description || conditionsChanged) {
        await onSubmit(whole ? { description: text } : { body: text, acceptance: conditions });
        setSaved((current) => ({ ...current, description: text, acceptance: conditions }));
      }
      // 3. The title. The draft state is not changed here; finalizing is done in the detail panel.
      const nextTitle = title.trim();
      if (nextTitle !== saved.title) {
        await onSubmit({ title: nextTitle });
        setSaved((current) => ({ ...current, title: nextTitle }));
      }
    });
  };

  return (
    <EditorShell
      taskId={task.id}
      title={t('editor.editCardTitle')}
      badge=""
      variant="edit"
      dirty={dirty}
      saving={flow.saving}
      error={flow.error}
      onRetry={save}
      overLimit={overLimit}
      onClose={onClose}
      status={dirty ? t('editor.unsaved') : t('editor.noChanges')}
      actions={
        <Button type="button" disabled={flow.saving || !valid || !dirty} onClick={save}>
          {flow.saving ? t('dialog.saving') : t('editor.save')}
        </Button>
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
        dock={
          whole ? undefined : (
            <ConditionsDock
              id={conditionsId}
              items={conditions}
              onChange={setConditions}
              disabled={flow.saving}
            />
          )
        }
        outlineTop={whole ? undefined : <ConditionsLink id={conditionsId} items={conditions} />}
        asideTop={
          task.epic ? (
            <div className="editor__epic-row">
              <span className="editor__epic-caption">{t('editor.epic')}</span>
              <span
                className="editor__epic-chip"
                style={{ background: task.epic.color, color: epicInk(task.epic.color) }}
                title={task.epic.name}
              >
                {task.epic.id}
              </span>
            </div>
          ) : undefined
        }
        attachmentNotice={attachmentState.error}
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
