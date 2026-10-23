import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TaskSummary, Epic } from '../../../shared/api/contracts';
import type { StoredAttachment } from '../../../shared/ui/editor/attachmentTypes';
import { EPIC_DOCUMENT_LIMIT, normalizeNewlines } from '../../../shared/ui/editor/limits';
import type { RichMarkdownEditorHandle } from '../../../shared/rich-editor/RichMarkdownEditor';
import { useAttachmentState } from '../../../shared/ui/editor/useAttachmentState';
import { useMultipartRequest } from '../../../shared/ui/editor/useMultipartRequest';
import type { EpicApi } from './epicApi';
import {
  nameIsValid,
  orderOf,
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
}: {
  epic: Epic;
  tasks: readonly TaskSummary[];
  api: EpicApi;
  projectId: string;
  onOpenTask: (taskId: number) => void;
  onClose: () => void;
  onSavingChange?: (saving: boolean) => void;
}) {
  const { t } = useTranslation();
  const editor = useRef<RichMarkdownEditorHandle>(null);
  const requestId = useMultipartRequest();
  const members = tasks.filter((task) => task.epic?.id === epic.id);
  const [saved, setSaved] = useState(() => ({
    name: epic.name,
    color: epic.color.toUpperCase(),
    isDraft: epic.isDraft,
    document: normalizeNewlines(epic.priorityError ? epic.document : epic.body),
    order: orderOf(epic.priority, members),
  }));
  const [order, setOrder] = useState<number[]>(() => saved.order);
  const [panel, setPanel] = useState<EpicEditorPanel>('progress');
  const [name, setName] = useState(epic.name);
  const [color, setColor] = useState(epic.color.toUpperCase());
  const whole = epic.priorityError;
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

  const stepName = (step: EpicSaveStep): string =>
    step === 'images'
      ? t('epic.stepImages')
      : step === 'document'
        ? t('epic.stepDocument')
        : step === 'details'
          ? t('epic.stepDetails')
          : t('epic.stepOrder');

  const run = async () => {
    if (busy.current || !valid) return;
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
      step = 'document';
      const text = currentDocument();
      if (text !== saved.document) {
        await api.saveDocument(whole ? { document: text } : { body: text });
        somethingSaved.current = true;
        setSaved((current) => ({ ...current, document: text }));
      }
      step = 'details';
      const details = { name: name.trim(), color: color.toUpperCase(), isDraft: saved.isDraft };
      if (
        details.name !== saved.name ||
        details.color !== saved.color ||
        details.isDraft !== saved.isDraft
      ) {
        await api.saveDetails(details);
        somethingSaved.current = true;
        setSaved((current) => ({ ...current, ...details }));
      }
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

  const requestOpenTask = (taskId: number) => {
    if (dirty) setPendingTask(taskId);
    else onOpenTask(taskId);
  };

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
  };
}
