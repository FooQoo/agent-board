import { ArchiveRestoreIcon, FilePenIcon, PencilIcon as EditIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { setDraft } from '../api/edit';
import { noOperations, type OperationControls } from '../../../shared/lib/operations/operations';
import type { Task, Epic, Problem, ProjectId } from '../../../shared/api/contracts';
import { DeleteButton } from '../delete/DeleteButton';
import { DeleteConfirm } from '../delete/DeleteConfirm';
import type { DetailTab } from './DetailTabs';
import { TaskDetailView } from './TaskDetailView';
import { DraftBanner } from './DraftBanner';
import './detail.css';

export interface DetailPanelProps {
  /** The project the card belongs to. Part keys and delete requests use it. */
  projectId: ProjectId | null;
  task: Task | null;
  /** Used where the panel only holds a project state (switching, failure, none): the hint sits at the top. */
  variant?: 'card' | 'state';
  /** Tells the app about the delete confirmation, so the project cannot change under it. */
  operations?: OperationControls;
  onClose: () => void;
  /** The edit icon (shown for a draft) was pressed. */
  onEdit?: (task: Task) => void;
  /** A draft toggle or an answer was saved: the board should be fetched again. */
  onChanged?: () => void;
  /** Runs archive/delete through the app's project-bound lifecycle operation. */
  onRemove: (action: 'archive' | 'delete', task: Task) => Promise<boolean>;
  /** Mock mode only: open the delete confirmation immediately. */
  initialConfirm?: boolean;
  /** Mock mode only: show the delete failure message immediately. */
  initialDeleteFailed?: boolean;
  /** Resolves owned attachments for the body and the attachment list. */
  attachmentUrl?: (id: string) => string;
  /** Archive view changes the destructive action to permanent deletion. */
  archived?: boolean;
  /** The board's format defects. The ones of this card's files are shown above its body. */
  problems?: readonly Problem[];
  /** The project's epics, for the epic tab. Undefined while the board is loading. */
  epics?: readonly Epic[];
  epicsFailed?: boolean;
  onRetryEpics?: () => void;
  onRestore?: () => void;
  operationSaving?: boolean;
  restoreFailed?: boolean;
}

export function DetailPanel({
  projectId,
  task,
  variant = 'card',
  operations = noOperations,
  onClose,
  onEdit,
  onChanged,
  onRemove,
  initialConfirm,
  initialDeleteFailed,
  attachmentUrl,
  archived = false,
  onRestore,
  operationSaving = false,
  restoreFailed = false,
  problems = [],
  epics,
  epicsFailed = false,
  onRetryEpics,
}: DetailPanelProps) {
  const { t } = useTranslation();
  if (task === null || projectId === null) {
    return (
      <aside
        className={`detail detail--empty${variant === 'state' ? ' detail--state' : ''}`}
        aria-label={t('detail.title')}
      >
        <p className="detail__empty-message">
          {t(variant === 'state' ? 'detail.selectPromptState' : 'detail.selectPrompt')}
        </p>
      </aside>
    );
  }
  return (
    <DetailBody
      key={`${projectId}:${task.id}`}
      projectId={projectId}
      operations={operations}
      task={task}
      onClose={onClose}
      onEdit={onEdit}
      onChanged={onChanged}
      onRemove={onRemove}
      initialConfirm={initialConfirm}
      initialDeleteFailed={initialDeleteFailed}
      archived={archived}
      onRestore={onRestore}
      operationSaving={operationSaving}
      restoreFailed={restoreFailed}
      problems={problems}
      epics={epics}
      epicsFailed={epicsFailed}
      onRetryEpics={onRetryEpics}
      attachmentUrl={attachmentUrl}
    />
  );
}

interface DetailBodyProps
  extends Omit<DetailPanelProps, 'task' | 'variant' | 'operations' | 'projectId' | 'problems'> {
  projectId: ProjectId;
  task: Task;
  operations: OperationControls;
  problems: readonly Problem[];
}

type ConfirmState = 'closed' | 'initial' | 'user';

function DetailBody({
  projectId,
  task,
  operations,
  onClose,
  onEdit,
  onChanged,
  onRemove,
  initialConfirm,
  initialDeleteFailed,
  attachmentUrl,
  archived,
  onRestore,
  operationSaving,
  restoreFailed,
  problems,
  epics,
  epicsFailed,
  onRetryEpics,
}: DetailBodyProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<DetailTab>('description');
  const [confirm, setConfirm] = useState<ConfirmState>(initialConfirm ? 'initial' : 'closed');
  const [draftSaving, setDraftSaving] = useState(false);
  const [draftFailed, setDraftFailed] = useState(false);
  const draftBusy = useRef(false);
  const deleteButton = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const operationsRef = useRef(operations);
  operationsRef.current = operations;
  const confirming = confirm !== 'closed';

  // The open confirmation is an operation: the project cannot change until it is done or cancelled.
  useEffect(() => {
    if (!confirming) return;
    const id = operationsRef.current.begin(archived ? 'delete' : 'archive', projectId);
    return () => {
      operationsRef.current.end(id);
    };
  }, [archived, confirming, projectId]);

  useEffect(() => {
    if (confirm === 'closed' && restoreFocus.current) {
      restoreFocus.current = false;
      deleteButton.current?.focus();
    }
  }, [confirm]);

  const toggleDraft = async (isDraft: boolean) => {
    if (draftBusy.current) return;
    draftBusy.current = true;
    setDraftSaving(true);
    setDraftFailed(false);
    try {
      await setDraft(projectId, task.id, isDraft);
      onChanged?.();
    } catch {
      setDraftFailed(true);
    } finally {
      draftBusy.current = false;
      setDraftSaving(false);
    }
  };

  const canMakeDraft = !task.isDraft && task.agentStatus !== 'running';

  return (
    <TaskDetailView
      projectId={projectId}
      task={task}
      tab={tab}
      onTabChange={setTab}
      onClose={onClose}
      epics={epics}
      epicsFailed={epicsFailed}
      onRetryEpics={onRetryEpics}
      readOnlyDraft={false}
      toolbar={
        archived ? (
          <div className="detail__toolbar" role="toolbar" aria-label={t('detail.toolbar')}>
            {onRestore && (
              <button
                type="button"
                className="detail__tool detail__tool--text detail__restore"
                title={t('archive.restore')}
                disabled={operationSaving}
                onClick={onRestore}
              >
                <ArchiveRestoreIcon aria-hidden="true" />
                {t('archive.restore')}
              </button>
            )}
            <DeleteButton
              ref={deleteButton}
              action="delete"
              disabled={operationSaving}
              onClick={() => setConfirm('user')}
            />
          </div>
        ) : (
          <div className="detail__toolbar" role="toolbar" aria-label={t('detail.toolbar')}>
            {tab === 'description' && task.isDraft && (
              <button
                type="button"
                className="detail__tool"
                aria-label={t('detail.edit')}
                title={t('detail.edit')}
                onClick={() => onEdit?.(task)}
              >
                <EditIcon aria-hidden="true" />
              </button>
            )}
            {canMakeDraft && (
              <button
                type="button"
                className="detail__tool detail__tool--text"
                aria-label={t('detail.makeDraft')}
                title={t('detail.makeDraft')}
                disabled={draftSaving}
                onClick={() => void toggleDraft(true)}
              >
                <FilePenIcon aria-hidden="true" />
                {t('detail.makeDraft')}
              </button>
            )}
            <DeleteButton
              ref={deleteButton}
              action="archive"
              disabled={operationSaving}
              onClick={() => setConfirm('user')}
            />
          </div>
        )
      }
      problems={problems}
      attachmentUrl={attachmentUrl}
    >
      {task.isDraft && !archived && (
        <DraftBanner
          busy={draftSaving}
          failed={draftFailed}
          onFinalize={() => void toggleDraft(false)}
        />
      )}
      {archived && restoreFailed && (
        <p className="detail__error" role="alert">
          {t('archive.restoreError')}
        </p>
      )}
      {confirming && (
        <DeleteConfirm
          task={task}
          action={archived ? 'delete' : 'archive'}
          saving={operationSaving ?? false}
          focusOnMount={confirm === 'user'}
          initialFailed={initialDeleteFailed}
          onCancel={() => {
            restoreFocus.current = true;
            setConfirm('closed');
          }}
          onConfirm={() => onRemove(archived ? 'delete' : 'archive', task)}
        />
      )}
      {draftFailed && !task.isDraft && (
        <p className="detail__error" role="alert">
          {t('detail.saveError')}
        </p>
      )}
    </TaskDetailView>
  );
}
