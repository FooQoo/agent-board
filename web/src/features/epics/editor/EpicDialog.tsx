// biome-ignore lint/style/noExcessiveLinesPerFile: predates the 300-line limit; split it by responsibility rather than growing it.
import { Button } from '@/shared/ui/button';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { epicInk } from '../model/epic';
import type { Task, Epic } from '../../../shared/api/contracts';
import { DiscardConfirm } from '../../../shared/ui/editor/DiscardConfirm';
import { EpicDeleteConfirm } from './EpicDeleteConfirm';
import { WriteError } from '../../../shared/api/writeErrors';
import { EditorBody, useOverLimit } from '../../../shared/ui/editor/EditorBody';
import { EditorShell } from '../../../shared/ui/editor/EditorShell';
import type { EditorAttachment, StoredAttachment } from '../../../shared/ui/editor/attachmentTypes';
import { DESCRIPTION_LIMIT, countChars, normalizeNewlines } from '../../../shared/ui/editor/limits';
import type { RichMarkdownEditorHandle } from '../../../shared/rich-editor/RichMarkdownEditor';
import { CollapsibleSection } from '../../../shared/ui/editor/CollapsibleSection';
import { EpicProgressList, type ProgressTaskRenderer } from './EpicProgressList';
import { EpicColorPicker } from './EpicColorPicker';
import { useAttachmentState } from '../../../shared/ui/editor/useAttachmentState';
import { useMultipartRequest } from '../../../shared/ui/editor/useMultipartRequest';
import { ListOrderedIcon } from 'lucide-react';

/** The writes an epic dialog makes, one at a time and in this order by the dialog. */
export interface EpicApi {
  /** Adds the new images to the epic; `requestId` makes a retry the same write. */
  addImages(files: EditorAttachment[], requestId: string): Promise<void>;
  removeImage(attachmentId: string): Promise<void>;
  /** The whole plan text, or its Markdown body, saved in one request. */
  savePlan(input: { plan: string } | { body: string }): Promise<void>;
  saveDetails(details: { name: string; color: string; isDraft: boolean }): Promise<void>;
  /** Saves the card order of the epic: the IDs of its tasks, first is first. */
  savePriority(priority: number[]): Promise<void>;
  /** Deletes the epic. The server refuses while a task still names it. */
  remove(): Promise<void>;
}

type Step = 'images' | 'plan' | 'details' | 'order';

/** Which panel of the right column is open. Opening one folds the other. */
type Panel = 'progress' | 'images';

const NAME_LIMIT = 100;

/** The name is one line of up to 100 characters. */
function nameIsValid(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length > 0 && !/[\r\n]/.test(trimmed) && [...trimmed].length <= NAME_LIMIT;
}

/**
 * The order of the tasks of an epic: the saved order first, then the tasks it does not list, by ID.
 * Only tasks in `members` are kept.
 */
function orderOf(priority: readonly number[], members: readonly Task[]): number[] {
  const ids = new Set(members.map((task) => task.id));
  const listed = priority.filter((id) => ids.has(id));
  const rest = members
    .map((task) => task.id)
    .filter((id) => !listed.includes(id))
    .sort((a, b) => a - b);
  return [...listed, ...rest];
}

/**
 * The dialog that edits an epic: the formal name, the color, the plan, the images, and the order
 * of its tasks in the progress table. One Save applies all of it, in the order images, plan,
 * name/color and the order. A step that finished stays saved; when a later step fails, the input stays
 * and only the rest is sent again.
 */
export function EpicDialog({
  epic,
  tasks,
  api,
  projectId = '',
  onOpenTask,
  onClose,
  onSavingChange,
  renderTask,
}: {
  epic: Epic;
  /** Draws a task in the progress table. The caller supplies it. */
  renderTask: ProgressTaskRenderer;
  /** Every task of the project, read when the dialog is shown and kept up to date by the board. */
  tasks: readonly Task[];
  api: EpicApi;
  projectId?: string;
  /** The person pressed a task name: the dialog closes and the board shows that task. */
  onOpenTask: (taskId: number) => void;
  onClose: () => void;
  onSavingChange?: (saving: boolean) => void;
}) {
  const { t } = useTranslation();
  const editor = useRef<RichMarkdownEditorHandle>(null);
  const requestId = useMultipartRequest();
  // The tasks of this epic, as the board has them now.
  const members = tasks.filter((task) => task.epic?.id === epic.id);
  // What the server has.
  const [saved, setSaved] = useState(() => ({
    name: epic.name,
    color: epic.color.toUpperCase(),
    isDraft: epic.isDraft,
    plan: normalizeNewlines(epic.priorityError ? epic.plan : epic.body),
    order: orderOf(epic.priority, members),
  }));
  // What the person has now: the order of the tasks as the saved order plus the changes.
  const [order, setOrder] = useState<number[]>(() => saved.order);
  const [panel, setPanel] = useState<Panel>('progress');
  const [name, setName] = useState(epic.name);
  const [color, setColor] = useState(epic.color.toUpperCase());
  // A plan whose frontmatter cannot be read is edited as its whole text, as it was before.
  const whole = epic.priorityError;
  const [plan, setPlan] = useState(saved.plan);
  const [removed, setRemoved] = useState<string[]>([]);
  const [pendingTask, setPendingTask] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
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

  const localAdded = attachmentState.attachments.filter((a) => a.source === 'local');
  const imagesChanged = localAdded.length > 0 || removed.length > 0;
  const planChanged = plan !== saved.plan;
  const detailsChanged = name.trim() !== saved.name || color.toUpperCase() !== saved.color;
  // The rows shown: the order the person has, with the tasks it does not list at the end.
  const rowIds = orderOf(order, members);
  const rows = rowIds
    .map((id) => members.find((task) => task.id === id))
    .filter((task): task is Task => task !== undefined);
  const orderChanged = JSON.stringify(order) !== JSON.stringify(saved.order);
  const dirty = imagesChanged || planChanged || detailsChanged || orderChanged;
  const overLimit = useOverLimit(plan);
  const valid = nameIsValid(name) && countChars(plan) <= DESCRIPTION_LIMIT;

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
        await api.savePlan(whole ? { plan: text } : { body: text });
        somethingSaved.current = true;
        setSaved((current) => ({ ...current, plan: text }));
      }
      // 3. The name and color, preserving the existing draft state.
      step = 'details';
      const details = {
        name: name.trim(),
        color: color.toUpperCase(),
        isDraft: saved.isDraft,
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
      // 4. The order of the tasks in the progress table.
      step = 'order';
      if (orderChanged) {
        await api.savePriority(rowIds);
        somethingSaved.current = true;
        setSaved((current) => ({ ...current, order: rowIds }));
        setOrder(rowIds);
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

  // Deleting the epic closes the dialog once the board has been fetched again; a refused delete keeps it open.
  const remove = async () => {
    if (busy.current) return;
    busy.current = true;
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.remove();
      busy.current = false;
      setDeleting(false);
      onClose();
    } catch (cause) {
      busy.current = false;
      setDeleting(false);
      setDeleteError(
        cause instanceof WriteError && cause.code === 'epic_in_use'
          ? t('epic.deleteInUse')
          : t('epic.deleteFailed'),
      );
    }
  };

  const stepName = (step: Step): string =>
    step === 'images'
      ? t('epic.stepImages')
      : step === 'plan'
        ? t('epic.stepPlan')
        : step === 'details'
          ? t('epic.stepDetails')
          : t('epic.stepOrder');

  const move = (from: number, to: number) =>
    setOrder(() => {
      const next = [...rowIds];
      const [moved] = next.splice(from, 1);
      if (moved !== undefined) next.splice(to, 0, moved);
      return next;
    });

  const requestOpenTask = (taskId: number) => {
    if (dirty) setPendingTask(taskId);
    else onOpenTask(taskId);
  };

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
            onClick={() => {
              setDeleteError(null);
              setConfirmDelete(true);
            }}
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
                background: color,
                color: epicInk(color),
              }}
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

/** The server's view of an image the screen has just saved: its metadata only. */
function storedOf({ id, name, mediaType, size, createdAt }: EditorAttachment): StoredAttachment {
  return { id, name, mediaType, size, createdAt };
}
