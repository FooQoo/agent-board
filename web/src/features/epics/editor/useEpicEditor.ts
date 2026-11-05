import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TaskSummary, Epic } from '../../../shared/api/contracts';
import {
  useFollowLatest,
  type ChangeSubscription,
} from '../../../shared/ui/editor/useFollowLatest';
import { usePreviewLock } from '../../../shared/ui/editor/usePreviewLock';
import type { StoredAttachment } from '../../../shared/ui/editor/attachmentTypes';
import { EPIC_DOCUMENT_LIMIT, normalizeNewlines } from '../../../shared/ui/editor/limits';
import type { RichMarkdownEditorHandle } from '../../../shared/rich-editor/RichMarkdownEditor';
import { useAttachmentState } from '../../../shared/ui/editor/useAttachmentState';
import { useMultipartRequest } from '../../../shared/ui/editor/useMultipartRequest';
import type { EpicApi, EpicSaveInput } from './epicApi';
import {
  epicSnapshot,
  nameIsValid,
  orderOf,
  snapshotOfEpic,
  storedOf,
  type EpicEditorPanel,
  type EpicSaveStep,
} from './epicEditorModel';
import { useOverLimit } from '../../../shared/ui/editor/EditorBody';

export function useEpicEditor({
  epic,
  tasks,
  api,
  projectId,
  onOpenTask,
  onClose,
  onSavingChange,
  subscribe,
  load,
}: {
  epic: Epic;
  tasks: readonly TaskSummary[];
  api: EpicApi;
  projectId: string;
  onOpenTask: (taskId: number) => void;
  onClose: () => void;
  onSavingChange?: (saving: boolean) => void;
  /** Tells that the epic may have changed outside the dialog; the dialog then reads it again. */
  subscribe?: ChangeSubscription;
  /** Reads the latest epic without a loading state; null when it found nothing or failed. */
  load?: () => Promise<Epic | null>;
}) {
  const { t } = useTranslation();
  const editor = useRef<RichMarkdownEditorHandle>(null);
  const requestId = useMultipartRequest();
  const members = tasks.filter((task) => task.epic?.id === epic.id);
  const [saved, setSaved] = useState(() => ({
    name: epic.name,
    color: epic.color.toUpperCase(),
    document: normalizeNewlines(epic.priorityError ? epic.document : epic.body),
    order: orderOf(epic.priority, members),
  }));
  const [order, setOrder] = useState<number[]>(() => saved.order);
  const [panel, setPanel] = useState<EpicEditorPanel>('progress');
  const [name, setName] = useState(epic.name);
  const [color, setColor] = useState(epic.color.toUpperCase());
  const [whole, setWhole] = useState(epic.priorityError);
  /** The epic was a draft before the dialog entered one (so saving does not finalize it). */
  const [wasDraft, setWasDraft] = useState(epic.isDraft);
  /** Changes when the dialog follows a new version: the editors start again from it. */
  const [version, setVersion] = useState(0);
  const [epicDocument, setEpicDocument] = useState(saved.document);
  const [removed, setRemoved] = useState<string[]>([]);
  const [pendingTask, setPendingTask] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
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
  const documentChanged = epicDocument !== saved.document;
  const detailsChanged = name.trim() !== saved.name || color.toUpperCase() !== saved.color;
  const rowIds = orderOf(order, members);
  const rows = rowIds
    .map((id) => members.find((task) => task.id === id))
    .filter((task): task is TaskSummary => task !== undefined);
  const orderChanged = JSON.stringify(order) !== JSON.stringify(saved.order);
  const dirty = imagesChanged || documentChanged || detailsChanged || orderChanged;
  const overLimit = useOverLimit(epicDocument, EPIC_DOCUMENT_LIMIT);
  const validName = nameIsValid(name);
  const valid = validName && overLimit === null;
  const currentDocument = () => normalizeNewlines(editor.current?.markdown() ?? epicDocument);

  const snapshot = epicSnapshot({
    name,
    color,
    document: epicDocument,
    imageIds: attachmentState.attachments.map((attachment) => attachment.id),
    order: rowIds,
  });
  const lock = usePreviewLock({
    draftAtOpen: wasDraft,
    // An epic has no running state and is never archived: nothing makes it read-only.
    readOnly: false,
    dirty,
    snapshot,
    enter: async () => snapshotOfEpic(await api.enterDraft(), members),
    leave: () => api.leaveDraft(),
  });
  // The images and the order are saved before the last request. If that request fails the editor
  // is no longer different from what the server holds, but the draft is still to be finalized.
  const [finalizePending, setFinalizePending] = useState(false);
  const canSave =
    valid && (lock.canSave || (finalizePending && lock.entered && lock.problem === null));

  const { updatedAt } = useFollowLatest<Epic>({
    subscribe,
    active: !dirty && !lock.entered && !saving,
    load: async () => {
      const latest = await load?.();
      if (latest === null || latest === undefined) return null;
      // Same content: no new state, so the editors keep their place.
      return snapshotOfEpic(latest, members) === snapshot ? null : latest;
    },
    apply: (latest) => {
      const text = normalizeNewlines(latest.priorityError ? latest.document : latest.body);
      const latestOrder = orderOf(latest.priority, members);
      setSaved({
        name: latest.name,
        color: latest.color.toUpperCase(),
        document: text,
        order: latestOrder,
      });
      setName(latest.name);
      setColor(latest.color.toUpperCase());
      setEpicDocument(text);
      setOrder(latestOrder);
      setRemoved([]);
      setWhole(latest.priorityError);
      setWasDraft(latest.isDraft);
      attachmentState.reset(latest.attachments);
      setVersion((current) => current + 1);
    },
  });

  const stepName = (step: EpicSaveStep): string =>
    step === 'images'
      ? t('epic.stepImages')
      : step === 'order'
        ? t('epic.stepOrder')
        : t('epic.stepDocument');

  const run = async () => {
    if (busy.current || !canSave) return;
    busy.current = true;
    setSaving(true);
    setError(null);
    onSavingChange?.(true);
    let step: EpicSaveStep = 'images';
    try {
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
      step = 'order';
      if (orderChanged) {
        await api.savePriority(rowIds);
        somethingSaved.current = true;
        setSaved((current) => ({ ...current, order: rowIds }));
        setOrder(rowIds);
      }
      // The order is saved under its own lock, so the epic goes last: its request also ends
      // the draft the dialog entered.
      step = 'epic';
      if (!wasDraft || documentChanged || detailsChanged) {
        const text = currentDocument();
        const base = { name: name.trim(), color: color.toUpperCase() };
        const input: EpicSaveInput = whole
          ? { ...base, document: text, ...(wasDraft ? {} : { isDraft: false as const }) }
          : { ...base, body: text, ...(wasDraft ? {} : { isDraft: false as const }) };
        await api.save(input);
        somethingSaved.current = true;
        setSaved((current) => ({ ...current, ...base, document: text }));
      }
      busy.current = false;
      setSaving(false);
      setFinalizePending(false);
      onClose();
    } catch {
      busy.current = false;
      setSaving(false);
      onSavingChange?.(false);
      setFinalizePending(step === 'epic');
      const label = stepName(step);
      setError(
        somethingSaved.current
          ? t('epic.saveFailedAt', { step: label })
          : t('epic.saveFailedFirst', { step: label }),
      );
    }
  };

  const move = (from: number, to: number) =>
    setOrder(() => {
      const next = [...rowIds];
      const [moved] = next.splice(from, 1);
      if (moved !== undefined) next.splice(to, 0, moved);
      return next;
    });

  /** Takes back the draft the dialog entered (if any), then goes on; a saved dialog does not. */
  const leaveThen = async (next: () => void) => {
    try {
      await lock.release();
    } catch {
      // The draft stays; "Finalize" on the epic's details lifts it.
    }
    next();
  };

  const requestOpenTask = (taskId: number) => {
    if (dirty) setPendingTask(taskId);
    else void leaveThen(() => onOpenTask(taskId));
  };

  const discardAndOpenTask = (taskId: number) => void leaveThen(() => onOpenTask(taskId));
  const close = () => void leaveThen(onClose);

  const removeAttachment = (id: string) => {
    const item = attachmentState.attachments.find((attachment) => attachment.id === id);
    if (item?.source === 'stored')
      setRemoved((current) => (current.includes(id) ? current : [...current, id]));
    attachmentState.remove(id);
  };

  return {
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
    canSave,
    /** The last request of a save failed after the rest was saved: the draft is still to finalize. */
    finalizePending,
    problem: lock.problem,
    retryLock: lock.retry,
    /** The dialog holds the draft: it entered one, or the epic was a draft already. */
    locked: wasDraft || lock.entered,
    updatedAt,
    version,
    validName,
    saving,
    error,
    run,
    pendingTask,
    setPendingTask,
    requestOpenTask,
    discardAndOpenTask,
    close,
    move,
    attachmentState,
    removeAttachment,
  };
}
