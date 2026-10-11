import { Button } from '@/components/ui/button';
import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { epicInk } from '../../lib/epic';
import type { Card, Epic } from '../../types';
import { Checkbox } from '../ui/checkbox';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { DiscardConfirm } from './DiscardConfirm';
import { EditorBody, useOverLimit } from './EditorBody';
import { EditorShell } from './EditorShell';
import type { EditorAttachment, StoredAttachment } from './attachmentTypes';
import { DESCRIPTION_LIMIT, countChars, normalizeNewlines } from './limits';
import type { RichMarkdownEditorHandle } from './RichMarkdownEditor';
import { EpicTaskList } from './EpicTaskList';
import { useAttachmentState } from './useAttachmentState';
import { useMultipartRequest } from './useMultipartRequest';

/** The writes an epic dialog makes, one at a time and in this order by the dialog. */
export interface EpicApi {
  /** Adds the new images to the epic; `requestId` makes a retry the same write. */
  addImages(files: EditorAttachment[], requestId: string): Promise<void>;
  removeImage(attachmentId: string): Promise<void>;
  savePlan(plan: string): Promise<void>;
  saveDetails(details: { name: string; color: string; isDraft: boolean }): Promise<void>;
  /** Puts a task into this epic (`epicId`) or takes it out (`null`). */
  setMembership(cardId: number, epicId: string | null): Promise<void>;
}

type Step = 'images' | 'plan' | 'details' | 'tasks';

const HEX = /^#[0-9A-Fa-f]{6}$/;
const NAME_LIMIT = 100;

/** The name is one line of up to 100 characters. */
function nameIsValid(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length > 0 && !/[\r\n]/.test(trimmed) && [...trimmed].length <= NAME_LIMIT;
}

/**
 * The dialog that edits an epic: the formal name, the color, the draft box, the plan, the images and
 * which tasks are in it. One Save applies all of it, in the order images, plan, name/color/draft and
 * the tasks. A step that finished stays saved; when a later step fails, the input stays and only the
 * rest is sent again.
 */
export function EpicDialog({
  epic,
  cards,
  api,
  projectId = '',
  onOpenTask,
  onClose,
  onSavingChange,
}: {
  epic: Epic;
  /** Every task of the project, read when the dialog is shown and kept up to date by the board. */
  cards: readonly Card[];
  api: EpicApi;
  projectId?: string;
  /** The person pressed a task name: the dialog closes and the board shows that task. */
  onOpenTask: (cardId: number) => void;
  onClose: () => void;
  onSavingChange?: (saving: boolean) => void;
}) {
  const { t } = useTranslation();
  const idPrefix = useId();
  const editor = useRef<RichMarkdownEditorHandle>(null);
  const requestId = useMultipartRequest();
  // The tasks in this epic when it was opened. Their order and the filter use this set.
  const [initialMembers] = useState(
    () => new Set(cards.filter((card) => card.epic?.id === epic.id).map((card) => card.id)),
  );
  // What the server has.
  const [saved, setSaved] = useState(() => ({
    name: epic.name,
    color: epic.color.toUpperCase(),
    isDraft: epic.isDraft,
    plan: normalizeNewlines(epic.plan),
  }));
  const [savedMembers, setSavedMembers] = useState(() => new Set(initialMembers));
  // What the person has now.
  const [name, setName] = useState(epic.name);
  const [color, setColor] = useState(epic.color.toUpperCase());
  const [isDraft, setIsDraft] = useState(epic.isDraft);
  const [plan, setPlan] = useState(saved.plan);
  const [members, setMembers] = useState(() => new Set(initialMembers));
  const [removed, setRemoved] = useState<string[]>([]);
  const [pendingTask, setPendingTask] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  // Whether a step has been saved in this dialog; it decides how a failure is worded.
  const somethingSaved = useRef(false);

  const attachmentState = useAttachmentState({
    initial: epic.attachments,
    resolveStoredUrl: (attachment: StoredAttachment) =>
      projectId
        ? `/api/projects/${projectId}/epics/${encodeURIComponent(epic.id)}/attachments/${encodeURIComponent(attachment.id)}`
        : '',
  });

  const colorValid = HEX.test(color);
  const localAdded = attachmentState.attachments.filter((a) => a.source === 'local');
  const imagesChanged = localAdded.length > 0 || removed.length > 0;
  const planChanged = plan !== saved.plan;
  const detailsChanged =
    name.trim() !== saved.name || color.toUpperCase() !== saved.color || isDraft !== saved.isDraft;
  const changedTasks = [...new Set([...savedMembers, ...members])]
    .filter((id) => savedMembers.has(id) !== members.has(id))
    .sort((a, b) => a - b);
  const dirty = imagesChanged || planChanged || detailsChanged || changedTasks.length > 0;
  const overLimit = useOverLimit(plan);
  const valid = nameIsValid(name) && colorValid && countChars(plan) <= DESCRIPTION_LIMIT;

  const currentPlan = () => normalizeNewlines(editor.current?.markdown() ?? plan);

  const run = async () => {
    if (busy.current || !valid) return;
    busy.current = true;
    setSaving(true);
    setError(null);
    onSavingChange?.(true);
    let step: Step = 'images';
    try {
      // 1. Images: removals first, then the new images in one request.
      if (imagesChanged) {
        for (const id of removed) {
          await api.removeImage(id);
          somethingSaved.current = true;
          setRemoved((current) => current.filter((item) => item !== id));
        }
        if (localAdded.length > 0) {
          await api.addImages(localAdded, requestId({ added: localAdded.map((a) => a.id) }));
          somethingSaved.current = true;
        }
        attachmentState.reset(attachmentState.attachments.map(storedOf));
        setRemoved([]);
      }
      // 2. The plan, as the editor holds it now.
      step = 'plan';
      const text = currentPlan();
      if (text !== saved.plan) {
        await api.savePlan(text);
        somethingSaved.current = true;
        setSaved((current) => ({ ...current, plan: text }));
      }
      // 3. The name, the color and the draft flag.
      step = 'details';
      const details = {
        name: name.trim(),
        color: color.toUpperCase(),
        isDraft,
      };
      if (
        details.name !== saved.name ||
        details.color !== saved.color ||
        details.isDraft !== saved.isDraft
      ) {
        await api.saveDetails(details);
        somethingSaved.current = true;
        setSaved((current) => ({ ...current, ...details }));
      }
      // 4. The tasks, one write per task.
      step = 'tasks';
      for (const cardId of changedTasks) {
        await api.setMembership(cardId, members.has(cardId) ? epic.id : null);
        somethingSaved.current = true;
        setSavedMembers((current) => {
          const next = new Set(current);
          if (members.has(cardId)) next.add(cardId);
          else next.delete(cardId);
          return next;
        });
      }
      busy.current = false;
      setSaving(false);
      onClose();
    } catch {
      busy.current = false;
      setSaving(false);
      onSavingChange?.(false);
      const stepLabel = stepName(step);
      const base = somethingSaved.current
        ? t('epic.saveFailedAt', { step: stepLabel })
        : t('epic.saveFailedFirst', { step: stepLabel });
      setError(base);
    }
  };

  const stepName = (step: Step): string =>
    step === 'images'
      ? t('epic.stepImages')
      : step === 'plan'
        ? t('epic.stepPlan')
        : step === 'details'
          ? t('epic.stepDetails')
          : t('epic.stepTasks');

  const requestOpenTask = (cardId: number) => {
    if (dirty) setPendingTask(cardId);
    else onOpenTask(cardId);
  };

  return (
    <EditorShell
      idLabel={epic.id}
      returnFocusSelector={`[data-epic-label="${epic.id}"]`}
      title={t('epic.editTitle')}
      badge={t('editor.draft')}
      variant="edit"
      dirty={dirty}
      saving={saving}
      error={error}
      onRetry={run}
      overLimit={overLimit}
      onClose={onClose}
      status={dirty ? t('editor.unsaved') : t('editor.noChanges')}
      footerStart={
        <div className="editor__draft">
          <Checkbox
            id={`${idPrefix}-draft`}
            checked={isDraft}
            aria-label={t('editor.draft')}
            disabled={saving}
            onCheckedChange={(checked) => setIsDraft(checked === true)}
          />
          <Label htmlFor={`${idPrefix}-draft`}>{t('editor.draft')}</Label>
        </div>
      }
      actions={
        <Button type="button" disabled={saving || !valid || !dirty} onClick={() => void run()}>
          {saving ? t('dialog.saving') : t('editor.save')}
        </Button>
      }
    >
      <EditorBody
        title={name}
        onTitleChange={setName}
        titleLabel={t('epic.nameLabel')}
        titleInvalid={!nameIsValid(name)}
        description={plan}
        onDescriptionChange={setPlan}
        bodyLabel={t('epic.planLabel')}
        editorRef={editor}
        disabled={saving}
        asideTop={
          <div className="epic-label-row">
            <span className="editor__epic-caption">{t('epic.label')}</span>
            <span
              className="editor__epic-chip"
              style={{
                background: colorValid ? color : saved.color,
                color: epicInk(colorValid ? color : saved.color),
              }}
              data-epic-label={epic.id}
            >
              {epic.id}
            </span>
            <input
              type="color"
              className="epic-label-row__swatch"
              aria-label={t('epic.colorPick')}
              value={colorValid ? color.toLowerCase() : saved.color.toLowerCase()}
              disabled={saving}
              onChange={(event) => setColor(event.target.value.toUpperCase())}
            />
            <Label htmlFor={`${idPrefix}-hex`} className="epic-label-row__caption">
              {t('epic.hex')}
            </Label>
            <Input
              id={`${idPrefix}-hex`}
              className="epic-label-row__hex"
              value={color}
              maxLength={7}
              disabled={saving}
              aria-invalid={colorValid ? undefined : true}
              onChange={(event) => setColor(event.target.value)}
            />
            {!colorValid && <span className="epic-label-row__error">{t('epic.hexInvalid')}</span>}
          </div>
        }
        sidebar={
          <EpicTaskList
            cards={cards}
            initialMembers={initialMembers}
            members={members}
            disabled={saving}
            onToggle={(cardId, included) =>
              setMembers((current) => {
                const next = new Set(current);
                if (included) next.add(cardId);
                else next.delete(cardId);
                return next;
              })
            }
            onOpenTask={requestOpenTask}
          />
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
      <DiscardConfirm
        open={pendingTask !== null}
        onOpenChange={(open) => {
          if (!open) setPendingTask(null);
        }}
        onKeep={() => setPendingTask(null)}
        onDiscard={() => {
          const cardId = pendingTask;
          setPendingTask(null);
          if (cardId !== null) onOpenTask(cardId);
        }}
        keepLabel={t('editor.backToEdit')}
        discardLabel={t('editor.discardAndMove')}
      />
    </EditorShell>
  );
}

/** The server's view of an image the screen has just saved: its metadata only. */
function storedOf({ id, name, mediaType, size, createdAt }: EditorAttachment): StoredAttachment {
  return { id, name, mediaType, size, createdAt };
}
