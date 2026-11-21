import { ArchiveRestoreIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { setAcceptance } from '../api/edit';
import { noOperations, type OperationControls } from '../../../shared/lib/operations/operations';
import type { ReactNode } from 'react';
import type { EpicRef, Problem, ProjectId, TaskSummary } from '../../../shared/api/contracts';
import { useEpicDetail, useTaskDetail } from '../../../shared/data/react';
import { DeleteButton } from '../delete/DeleteButton';
import { DeleteConfirm } from '../delete/DeleteConfirm';
import type { DetailTab } from './DetailTabs';
import { TaskDetailView } from './TaskDetailView';
import { DraftBanner } from './DraftBanner';
import { useFinalizeDraft } from './useFinalizeDraft';
import { BacklogBanner } from './BacklogBanner';
import { PreviewAction } from './PreviewAction';
import './detail.css';

export interface DetailPanelProps {
  /** The project the card belongs to. Part keys and delete requests use it. */
  projectId: ProjectId | null;
  /** The card, as a list shows it. Its text, conditions and history are read as the tabs need them. */
  task: TaskSummary | null;
  /** Used where the panel only holds a project state (switching, failure, none): the hint sits at the top. */
  variant?: 'card' | 'state';
  /** Tells the app about the delete confirmation, so the project cannot change under it. */
  operations?: OperationControls;
  onClose: () => void;
  /** The Open full screen button was pressed: the app opens the preview dialog for the card. */
  onPreview?: (task: TaskSummary) => void;
  /** The epic tab's Open full screen button was pressed. The app opens the epic's preview. */
  onOpenEpic?: (epicId: string) => void;
  /** Draws the epic label of the epic tab's heading. The caller supplies it. */
  renderEpicLabel?: (epic: EpicRef) => ReactNode;
  /** A draft toggle or an answer was saved: the board should be fetched again. */
  onChanged?: () => void;
  /** Runs archive/delete through the app's project-bound lifecycle operation. */
  onRemove: (action: 'archive' | 'delete', task: TaskSummary) => Promise<boolean>;
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
  epics?: readonly EpicRef[];
  epicsFailed?: boolean;
  onRetryEpics?: () => void;
  onRestore?: () => void;
  operationSaving?: boolean;
  restoreFailed?: boolean;
  /** The result version a link points at: the panel opens its results tab on it. */
  focusResultVersion?: number | null;
  /** A history link: the panel opens its history tab. */
  focusHistory?: boolean;
  /** Sends this Backlog card to Todo; the app confirms a warning and shows the result. */
  onSend?: (id: number) => void;
  sendBusy?: boolean;
}

export function DetailPanel({
  projectId,
  task,
  variant = 'card',
  operations = noOperations,
  onClose,
  onPreview,
  onOpenEpic,
  renderEpicLabel,
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
  focusResultVersion = null,
  focusHistory = false,
  onSend,
  sendBusy,
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
      onPreview={onPreview}
      onOpenEpic={onOpenEpic}
      renderEpicLabel={renderEpicLabel}
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
      focusResultVersion={focusResultVersion}
      focusHistory={focusHistory}
      onSend={onSend}
      sendBusy={sendBusy}
    />
  );
}

interface DetailBodyProps
  extends Omit<DetailPanelProps, 'task' | 'variant' | 'operations' | 'projectId' | 'problems'> {
  projectId: ProjectId;
  task: TaskSummary;
  operations: OperationControls;
  problems: readonly Problem[];
}

type ConfirmState = 'closed' | 'initial' | 'user';

function DetailBody({
  projectId,
  task,
  operations,
  onClose,
  onPreview,
  onOpenEpic,
  renderEpicLabel,
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
  focusResultVersion = null,
  focusHistory = false,
  onSend,
  sendBusy,
}: DetailBodyProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<DetailTab>(
    focusResultVersion !== null ? 'results' : focusHistory ? 'history' : 'description',
  );
  // A link to another result of the same task opens the results tab again.
  useEffect(() => {
    if (focusResultVersion !== null) setTab('results');
  }, [focusResultVersion]);
  // A link to the history of a task opens the history tab.
  useEffect(() => {
    if (focusHistory) setTab('history');
  }, [focusHistory]);
  const [confirm, setConfirm] = useState<ConfirmState>(initialConfirm ? 'initial' : 'closed');
  const deleteButton = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const operationsRef = useRef(operations);
  operationsRef.current = operations;
  const confirming = confirm !== 'closed';
  // Opening the drawer reads the whole task and its epic once, so every tab shows at once; the tabs only
  // choose what they show.
  const detail = useTaskDetail(projectId, task.id);
  const epicDetail = useEpicDetail(projectId, task.epic?.id ?? null);

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

  const { draftSaving, draftFailed, finalizeDraft } = useFinalizeDraft(
    projectId,
    task.id,
    onChanged,
  );

  // The person may check and uncheck conditions on any task that is not archived.
  const toggleCondition = async (conditionId: string, done: boolean) => {
    await setAcceptance(projectId, task.id, conditionId, done);
    void detail.refresh();
    onChanged?.();
  };

  return (
    <TaskDetailView
      projectId={projectId}
      task={task}
      document={detail.document}
      history={detail.history}
      epicDocument={epicDetail.document}
      onRetryDocument={() => void detail.refresh()}
      onRetryHistory={() => void detail.refresh()}
      onRetryEpicDocument={() => void epicDetail.refresh()}
      tab={tab}
      onTabChange={setTab}
      swipeTabs
      focusResultVersion={focusResultVersion}
      onClose={onClose}
      epics={epics}
      epicsFailed={epicsFailed}
      onRetryEpics={onRetryEpics}
      readOnlyDraft={false}
      onToggleCondition={archived ? undefined : toggleCondition}
      onOpenEpic={onOpenEpic}
      renderEpicLabel={renderEpicLabel}
      toolbar={
        archived ? (
          <div className="detail__toolbar" role="toolbar" aria-label={t('detail.toolbar')}>
            <PreviewAction onPreview={() => onPreview?.(task)} />
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
            <PreviewAction onPreview={() => onPreview?.(task)} />
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
      {task.taskStatus === 'backlog' && !archived && (
        <BacklogBanner busy={sendBusy} onSend={onSend ? () => onSend(task.id) : undefined} />
      )}
      {task.draft !== null && !archived && (
        <DraftBanner
          busy={draftSaving}
          failed={draftFailed}
          onFinalize={() => void finalizeDraft()}
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
      {draftFailed && task.draft === null && (
        <p className="detail__error" role="alert">
          {t('detail.saveError')}
        </p>
      )}
    </TaskDetailView>
  );
}
