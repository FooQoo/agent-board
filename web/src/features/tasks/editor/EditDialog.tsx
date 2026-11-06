import { Button } from '@/shared/ui/button';
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { ActionDialogData } from '../model/actionData';
import type { AcceptanceItem, EpicRef, Task } from '../../../shared/api/contracts';
import { acceptanceProblem } from '../acceptance/model/acceptance';
import { ConditionsDock } from '../acceptance/ConditionsDock';
import { EditorBody, useOverLimit } from '../../../shared/ui/editor/EditorBody';
import { EditorShell } from '../../../shared/ui/editor/EditorShell';
import {
  DESCRIPTION_LIMIT,
  countChars,
  normalizeNewlines,
  titleProblem,
} from '../../../shared/ui/editor/limits';
import type { RichMarkdownEditorHandle } from '../../../shared/rich-editor/RichMarkdownEditor';
import { useSaveFlow } from '../../../shared/ui/editor/useSaveFlow';
import { useAttachmentState } from '../../../shared/ui/editor/useAttachmentState';
import { useMultipartRequest } from '../../../shared/ui/editor/useMultipartRequest';
import type { StoredAttachment } from '../../../shared/ui/editor/attachmentTypes';
import {
  useFollowLatest,
  type ChangeSubscription,
} from '../../../shared/ui/editor/useFollowLatest';
import { usePreviewLock } from '../../../shared/ui/editor/usePreviewLock';
import { contentOf, snapshotOf, snapshotOfContent, type EditorContent } from './editorContent';
import { usePreviewStatus, type ReadOnlyReason } from './PreviewStatus';

export interface EditDialogProps {
  task: Task;
  /** Draws the epic chip beside the editor. The caller supplies it. */
  renderEpicChip: (epic: EpicRef) => ReactNode;
  onClose: () => void;
  onSavingChange?: (saving: boolean) => void;
  onSubmit: (data: ActionDialogData) => Promise<void>;
  projectId?: string;
  /** Running or archived: the preview only reads. */
  readOnlyReason?: ReadOnlyReason;
  /** Calls the listener when the card may have changed; the preview then reads it again. */
  subscribeChanges?: ChangeSubscription;
  /** Makes the card a draft and returns what the server holds then. */
  enterDraft?: () => Promise<Task>;
  /** Takes the draft back (discard). */
  leaveDraft?: () => Promise<void>;
  /** Reads the latest card without a loading state; null when it could not be read. */
  reload?: () => Promise<Task | null>;
}

/**
 * The preview of a card: it reads the card, follows changes while nothing was typed, and makes the
 * card a draft at the first change. Save sends the images first and then one last request with the
 * title, body, conditions and, if this dialog made the draft, the end of the draft. A step that
 * finished stays saved; when a later step fails, the input stays and only the rest is sent again.
 */
export function EditDialog({
  task,
  onClose,
  onSavingChange,
  onSubmit,
  projectId,
  renderEpicChip,
  readOnlyReason,
  subscribeChanges,
  enterDraft,
  leaveDraft,
  reload,
}: EditDialogProps) {
  const { t } = useTranslation();
  const editor = useRef<RichMarkdownEditorHandle>(null);
  // A card whose frontmatter cannot be read is edited as its whole text, as it was before.
  const whole = task.acceptanceError;
  // What the server has: the baseline the unsaved-change check compares with.
  const [saved, setSaved] = useState<EditorContent>(() => contentOf(task, whole));
  const [title, setTitle] = useState(saved.title);
  const [description, setDescription] = useState(saved.description);
  const [conditions, setConditions] = useState<AcceptanceItem[]>(saved.acceptance);
  const [editorKey, setEditorKey] = useState(0);
  const conditionsId = useId();
  const [removed, setRemoved] = useState<string[]>([]);
  const attachmentState = useAttachmentState({
    initial: saved.attachments,
    resolveStoredUrl: (attachment) =>
      projectId
        ? `/api/projects/${projectId}/tasks/${task.id}/attachments/${encodeURIComponent(attachment.id)}`
        : '',
  });
  const flow = useSaveFlow({ onClose, onSavingChange });
  const requestId = useMultipartRequest();
  const readOnly = readOnlyReason !== undefined;

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

  const lock = usePreviewLock({
    draftAtOpen: task.isDraft,
    readOnly,
    dirty,
    snapshot: snapshotOf({
      title: title.trim(),
      description,
      acceptance: whole ? [] : conditions,
      attachmentIds: attachmentState.attachments.map((a) => a.id),
    }),
    enter: async () => snapshotOfContent(enterDraft ? contentOf(await enterDraft(), whole) : saved),
    leave: async () => {
      await leaveDraft?.();
    },
  });
  const locked = task.isDraft || lock.entered;

  const follow = useFollowLatest<EditorContent>({
    subscribe: subscribeChanges,
    active: !dirty && !flow.saving,
    load: async () => {
      const next = await reload?.();
      if (!next) return null;
      const content = contentOf(next, whole);
      return snapshotOfContent(content) === snapshotOfContent(saved) ? null : content;
    },
    apply: (content) => {
      setSaved(content);
      setTitle(content.title);
      setDescription(content.description);
      setConditions(content.acceptance);
      setRemoved([]);
      attachmentState.reset(content.attachments);
      setEditorKey((key) => key + 1);
    },
  });

  // A change notice also says the run may have ended: enter again after a refusal.
  const { retry: retryLock, release } = lock;
  useEffect(() => subscribeChanges?.(retryLock), [subscribeChanges, retryLock]);

  const { badge, status } = usePreviewStatus({
    readOnlyReason,
    problem: lock.problem,
    dirty,
    locked,
    updatedAt: follow.updatedAt,
  });

  // Cancel and discard take back the draft this dialog made. After a save nothing is released.
  const close = useCallback(async () => {
    try {
      await release();
    } catch {
      // The draft stays; "Finalize" on the card releases it.
    }
    onClose();
  }, [release, onClose]);

  // The images are saved but the last request failed: nothing differs any more, yet the end of
  // the draft is still to be sent, so Save and Retry stay available until it goes through.
  const [lastPending, setLastPending] = useState(false);
  const canSend = lock.canSave || (lastPending && !readOnly && lock.problem === null);

  const save = () => {
    if (!valid || !canSend || flow.busy.current) return;
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
          requestId: requestId({ added: localAdded.map((a) => a.id), removed }),
          attachments: attachmentState.attachments,
          removedAttachmentIds: removed,
        });
        setRemoved([]);
        attachmentState.reset(remaining);
        setSaved((current) => ({ ...current, attachments: remaining }));
        setLastPending(true);
      }
      // 2. The last request: the body with the conditions (one file write), the title, and the end
      // of the draft when this dialog made it. The editor holds the text the reader typed.
      const text = normalizeNewlines(editor.current?.markdown() ?? description);
      const nextTitle = title.trim();
      const input: ActionDialogData = {};
      if (whole ? text !== saved.description : text !== saved.description || conditionsChanged)
        Object.assign(
          input,
          whole ? { description: text } : { body: text, acceptance: conditions },
        );
      if (nextTitle !== saved.title) input.title = nextTitle;
      // Without `enterDraft` nothing was entered on the server, so there is nothing to end.
      if (lock.entered && enterDraft) input.finalize = true;
      if (Object.keys(input).length > 0) await onSubmit(input);
      setLastPending(false);
    });
  };

  return (
    <EditorShell
      taskId={task.id}
      title={t('editor.previewTaskTitle')}
      badge={badge}
      variant="edit"
      dialogData={readOnly ? { 'data-read-only': '' } : undefined}
      dirty={dirty}
      saving={flow.saving}
      error={flow.error ?? (lock.problem === 'failed' ? t('editor.saveFailed') : null)}
      onRetry={flow.error !== null ? save : lock.retry}
      overLimit={overLimit}
      onClose={() => void close()}
      status={status}
      closeLabel={dirty && !readOnly ? undefined : t('dialog.close')}
      onSave={save}
      actions={
        <Button type="button" disabled={flow.saving || !valid || !canSend} onClick={save}>
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
        editorKey={editorKey}
        disabled={flow.saving || readOnly}
        dock={
          whole ? undefined : (
            <ConditionsDock
              id={conditionsId}
              items={conditions}
              onChange={setConditions}
              disabled={flow.saving || readOnly}
            />
          )
        }
        asideTop={
          task.epic ? (
            <div className="editor__epic-row">
              <span className="editor__epic-caption">{t('editor.epic')}</span>
              {renderEpicChip(task.epic)}
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
