import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { parseAsString, useQueryState } from 'nuqs';
import { useTranslation } from 'react-i18next';
import { ActionDialog } from './components/ActionDialog';
import { Board } from './components/Board';
import { BulkArchiveDialog } from './components/archive/BulkArchiveDialog';
import { ArchiveList } from './components/archive/ArchiveList';
import { EpicList } from './components/epics/EpicList';
import { EpicDetailPanel } from './components/epics/EpicDetailPanel';
import type { BoardMessageKind } from './components/BoardMessage';
import { DetailPanel } from './components/DetailPanel';
import { Header } from './components/Header';
import { ResizeHandle } from './components/ResizeHandle';
import { StatusBar, type StatusBarProps } from './components/StatusBar';
import {
  createNewTask,
  editTask,
  editTaskMultipart,
  moveTask,
  reorderTask,
  WriteError,
} from './api';
import { epicApi } from './components/editor/epicApi';
import { useBoard } from './hooks/useBoard';
import { useArchive } from './hooks/useArchive';
import { useTaskLifecycle } from './hooks/useTaskLifecycle';
import { useBoardEvents } from './hooks/useBoardEvents';
import { useDetailWidth } from './hooks/useDetailWidth';
import { useProjects } from './hooks/useProjects';
import { STALE_PAGE_EVENT } from './api';
import { StalePageNotice } from './components/notice/StalePageNotice';
import { findTask, groupTasks, nextSelection } from './lib/board';
import { isProjectId } from './lib/projectSession';
import { useProjectSession } from './hooks/useProjectSession';
import { useTaskAnswers } from './hooks/useTaskAnswers';
import type { Assignee, ColumnName, DialogAction, ProjectId } from './types';

export interface AppProps {
  /** Mock mode only: initial UI state taken from the page URL (see `src/mock.ts`). */
  initial?: { select?: number; confirm?: boolean; deleteFail?: boolean };
}

/** What the board area shows. The URL names the project; everything else follows from the data. */
type View =
  | 'projects-loading'
  | 'projects-error'
  | 'no-projects'
  | 'resolving'
  | 'not-found'
  | 'board-loading'
  | 'board-error'
  | 'board';

const BOARD_MESSAGE: Partial<Record<View, Exclude<BoardMessageKind, 'empty'>>> = {
  'projects-loading': 'loading',
  'projects-error': 'error',
  'no-projects': 'noProjects',
  resolving: 'switching',
  'not-found': 'notFound',
  'board-loading': 'switching',
  'board-error': 'boardError',
};

const STATUS_NOTE: Partial<Record<View, StatusBarProps['note']>> = {
  'no-projects': 'noProjects',
  resolving: 'boardLoading',
  'not-found': 'noSelection',
  'board-loading': 'boardLoading',
  'board-error': 'notSynced',
};

export function App({ initial }: AppProps) {
  const { t } = useTranslation();
  const [requested, setRequested] = useQueryState('project', parseAsString);
  const { session, dispatch, operations, answerLeaseControls } = useProjectSession(
    requested,
    initial?.select ?? null,
  );
  const taskAnswers = useTaskAnswers(answerLeaseControls.set);
  const projects = useProjects();

  const activeId = session.activeProjectId;
  const known =
    isProjectId(activeId) && projects.projects.some((project) => project.id === activeId);
  const board = useBoard(known ? activeId : null);
  const archive = useArchive(session.viewMode === 'archive' && known ? activeId : null);
  const archiveLifecycle = useTaskLifecycle(operations);
  const [restoreFailure, setRestoreFailure] = useState<{
    projectId: ProjectId;
    taskId: number;
  } | null>(null);

  // The first visit without a project in the URL shows the first project, replacing the history entry.
  const firstProject = projects.status === 'ready' ? (projects.projects[0] ?? null) : null;
  const [stalePage, setStalePage] = useState(false);
  useEffect(() => {
    const onStale = () => setStalePage(true);
    window.addEventListener(STALE_PAGE_EVENT, onStale);
    return () => window.removeEventListener(STALE_PAGE_EVENT, onStale);
  }, []);
  useEffect(() => {
    if (requested === null && firstProject !== null && session.operation === null) {
      void setRequested(firstProject.id, { history: 'replace' });
    }
  }, [requested, firstProject, session.operation, setRequested]);

  let view: View;
  if (projects.status === 'loading') view = 'projects-loading';
  else if (projects.status === 'error') view = 'projects-error';
  else if (projects.projects.length === 0) view = 'no-projects';
  else if (activeId === null) view = 'resolving';
  else if (!known || board.error === 'not_found') view = 'not-found';
  else if (board.status === 'ready') view = 'board';
  else view = board.status === 'error' ? 'board-error' : 'board-loading';

  const archiveVisible = session.viewMode === 'archive' && known && view !== 'not-found';
  const epicsVisible = session.viewMode === 'epics' && known && view !== 'not-found';

  // A deleted project shows up in the list on the next refresh; ask for it right away.
  const reloadProjects = projects.reload;
  useEffect(() => {
    if (board.error === 'not_found') reloadProjects();
  }, [board.error, reloadProjects]);

  const boardData = view === 'board' ? board.board : null;
  const tasks = isProjectId(activeId)
    ? taskAnswers.withSavedAnswers(activeId, boardData?.tasks ?? [], board.lastSyncedAt)
    : [];
  useEffect(() => {
    if (boardData && isProjectId(activeId)) taskAnswers.reconcileTasks(activeId, boardData.tasks);
  }, [activeId, boardData, taskAnswers.reconcileTasks]);
  const selected = findTask(tasks, session.selectedId);
  const archivedSelected =
    archive.data?.tasks.find((task) => task.id === session.archiveSelectedId) ?? null;
  const activeName = projects.projects.find((project) => project.id === activeId)?.name ?? null;
  useEffect(() => {
    if (boardData) {
      const next = nextSelection(boardData.tasks, session.selectedId);
      if (next !== session.selectedId) dispatch({ type: 'SELECT_CARD', id: next });
    }
  }, [boardData, session.selectedId, dispatch]);
  // The epic list reads the board's epics; a selected epic that is gone is deselected.
  const selectedEpic = boardData?.epics.find((epic) => epic.id === session.epicSelectedId) ?? null;
  useEffect(() => {
    if (boardData && session.epicSelectedId !== null && selectedEpic === null)
      dispatch({ type: 'SELECT_EPIC', id: null });
  }, [boardData, session.epicSelectedId, selectedEpic, dispatch]);
  useEffect(() => {
    if (
      archive.status === 'ready' &&
      session.archiveSelectedId !== null &&
      !archive.data?.tasks.some((task) => task.id === session.archiveSelectedId)
    )
      dispatch({ type: 'SELECT_ARCHIVE_CARD', id: null });
  }, [archive.data, archive.status, session.archiveSelectedId, dispatch]);

  // The title names the project whenever the header does (also while its board loads). A layout effect,
  // so the title is already set when the project name appears in the DOM.
  useLayoutEffect(() => {
    document.title = activeName !== null ? `${activeName} - Agent Board` : 'Agent Board';
  }, [activeName]);

  const reloadBoard = board.reload;
  const activeRef = useRef(activeId);
  activeRef.current = activeId;
  /** Fetches again after a save, but only while the project the save went to is still the one shown. */
  const refreshProject = useCallback(
    (projectId: ProjectId) => {
      if (activeRef.current === projectId) reloadBoard();
    },
    [reloadBoard],
  );

  const { streamDown } = useBoardEvents(
    useCallback(() => {
      reloadProjects();
      reloadBoard();
      archive.reload();
    }, [reloadProjects, reloadBoard, archive.reload]),
  );

  const openDialog = (dialog: DialogAction) => {
    if (session.operation !== null || !isProjectId(activeId)) return;
    operations.begin(dialog.kind, activeId, dialog);
  };

  const detailShown = view !== 'projects-loading' && view !== 'projects-error';
  const bodyRef = useRef<HTMLDivElement>(null);
  const layoutRef = useRef<HTMLElement>(null);
  const attachLayoutRef = useCallback((node: HTMLElement | null) => {
    layoutRef.current = node;
  }, []);
  const { width, startDrag, moveDrag, endDrag } = useDetailWidth(
    bodyRef,
    layoutRef,
    `${detailShown}:${session.viewMode}:${view}:${archive.status}`,
    epicsVisible ? 1 : 3,
  );
  const [mockInitial] = useState(initial);
  const isMockTask = selected !== null && selected.id === mockInitial?.select;

  const retry = view === 'projects-error' ? projects.reload : board.reload;
  const message = BOARD_MESSAGE[view] ?? null;
  const connected = !streamDown && !board.fetchFailed && !projects.fetchFailed;
  const dialog = session.dialog;
  const operation = session.operation;
  const barStatus =
    view === 'projects-loading' ? 'loading' : view === 'projects-error' ? 'error' : 'ready';

  return (
    <div className="app">
      {stalePage ? <StalePageNotice /> : null}
      <Header
        projects={detailShown ? projects.projects : null}
        activeProjectId={known ? activeId : null}
        switchDisabled={operation !== null}
        projectSwitchDisabled={operation !== null || session.answerLeases.length > 0}
        onSelectProject={(projectId) => {
          void setRequested(projectId, { history: 'push' });
        }}
        canAdd={view === 'board' && session.viewMode === 'board'}
        viewMode={session.viewMode}
        onBack={() => {
          dispatch({ type: 'SET_VIEW_MODE', mode: 'board' });
        }}
        onAdd={() => openDialog({ kind: 'create' })}
        onArchive={() => {
          dispatch({ type: 'SET_VIEW_MODE', mode: 'archive' });
        }}
        onEpics={() => {
          dispatch({ type: 'SET_VIEW_MODE', mode: 'epics' });
        }}
      />
      <div
        className="app__body"
        data-detail={detailShown && !(epicsVisible && selectedEpic === null) ? 'shown' : 'hidden'}
        ref={bodyRef}
        style={{ '--detail-width': `${width}px` } as CSSProperties}
      >
        {epicsVisible ? (
          <EpicList
            epics={boardData?.epics}
            counts={boardData?.epicTaskCounts ?? {}}
            status={board.status}
            fetchFailed={board.fetchFailed}
            selectedId={session.epicSelectedId}
            onSelect={(id) => dispatch({ type: 'SELECT_EPIC', id })}
            onRetry={board.reload}
            layoutRef={attachLayoutRef}
          />
        ) : archiveVisible ? (
          <ArchiveList
            data={archive.data}
            status={archive.status}
            fetchFailed={archive.fetchFailed}
            selectedId={session.archiveSelectedId}
            onSelect={(id) => dispatch({ type: 'SELECT_ARCHIVE_CARD', id })}
            onRetry={archive.reload}
            layoutRef={attachLayoutRef}
          />
        ) : (
          <Board
            message={message}
            tasks={tasks}
            selectedId={selected?.id ?? null}
            onSelect={(id) => dispatch({ type: 'SELECT_CARD', id })}
            onRetry={retry}
            layoutRef={attachLayoutRef}
            projectId={activeId as ProjectId}
            answers={taskAnswers}
            syncedAt={board.lastSyncedAt}
            onAnswerChanged={() => {
              if (isProjectId(activeId)) refreshProject(activeId);
            }}
            onOpenEpic={(epicId) => {
              const epic = boardData?.epics.find((item) => item.id === epicId);
              if (epic) openDialog({ kind: 'epic', epic });
            }}
            onMove={(task, column) => openDialog({ kind: 'move', task, target: column })}
            onReorder={(task, beforeId) => {
              if (!isProjectId(activeId)) return;
              const projectId = activeId;
              // The board is read again either way: a refused reorder puts the card back.
              reorderTask(projectId, task.id, beforeId)
                .catch(() => {})
                .finally(() => refreshProject(projectId));
            }}
            onArchiveDone={() => {
              if (!isProjectId(activeId) || session.operation !== null) return;
              operations.begin('archive-done', activeId);
              dispatch({
                type: 'OPEN_BULK_ARCHIVE',
                projectId: activeId,
                targets: groupTasks(tasks).done,
              });
            }}
          />
        )}
        {epicsVisible && selectedEpic !== null && isProjectId(activeId) && (
          <>
            <ResizeHandle startDrag={startDrag} moveDrag={moveDrag} endDrag={endDrag} />
            <EpicDetailPanel
              projectId={activeId}
              epic={selectedEpic}
              onEdit={() => openDialog({ kind: 'epic', epic: selectedEpic })}
              onClose={() => dispatch({ type: 'SELECT_EPIC', id: null })}
            />
          </>
        )}
        {!epicsVisible && detailShown && (
          <>
            <ResizeHandle startDrag={startDrag} moveDrag={moveDrag} endDrag={endDrag} />
            <DetailPanel
              projectId={known ? activeId : null}
              task={archiveVisible ? archivedSelected : selected}
              variant={
                archiveVisible
                  ? archive.status === 'ready'
                    ? 'card'
                    : 'state'
                  : view === 'board'
                    ? 'card'
                    : 'state'
              }
              operations={operations}
              problems={archiveVisible ? [] : (boardData?.problems ?? [])}
              epics={archiveVisible ? archive.data?.epics : boardData?.epics}
              epicsFailed={
                archiveVisible
                  ? archive.status === 'error'
                  : boardData === null && isProjectId(activeId)
              }
              onRetryEpics={() => {
                if (archiveVisible) archive.reload();
                else if (isProjectId(activeId)) refreshProject(activeId);
              }}
              onEdit={() => {
                if (selected?.isDraft) openDialog({ kind: 'edit', task: selected });
              }}
              onChanged={() => {
                if (isProjectId(activeId)) refreshProject(activeId);
              }}
              archived={archiveVisible}
              operationSaving={session.operation?.saving ?? false}
              restoreFailed={Boolean(
                restoreFailure?.projectId === activeId &&
                  restoreFailure.taskId === archivedSelected?.id,
              )}
              onRemove={async (action, task) => {
                if (!isProjectId(activeId)) return false;
                const projectId = activeId;
                const result = await archiveLifecycle.run(
                  action,
                  projectId,
                  { taskId: task.id },
                  { keepOperationOnError: true },
                );
                if (!result.ok) return false;
                refreshProject(projectId);
                if (session.viewMode === 'archive') archive.reload();
                return true;
              }}
              onRestore={() => {
                if (!isProjectId(activeId) || archivedSelected === null) return;
                const projectId = activeId;
                const taskId = archivedSelected.id;
                setRestoreFailure(null);
                void archiveLifecycle.run('restore', projectId, { taskId }).then((result) => {
                  if (!result.ok) {
                    setRestoreFailure({ projectId, taskId });
                    return;
                  }
                  dispatch({ type: 'SELECT_ARCHIVE_CARD', id: null });
                  archive.reload();
                  refreshProject(projectId);
                });
              }}
              onClose={() =>
                dispatch({
                  type: session.viewMode === 'archive' ? 'SELECT_ARCHIVE_CARD' : 'SELECT_CARD',
                  id: null,
                })
              }
              initialConfirm={isMockTask ? mockInitial?.confirm : undefined}
              initialDeleteFailed={isMockTask ? mockInitial?.deleteFail : undefined}
            />
          </>
        )}
      </div>
      <StatusBar
        status={archiveVisible ? archive.status : epicsVisible ? board.status : barStatus}
        taskCount={
          archiveVisible
            ? (archive.data?.tasks.length ?? 0)
            : epicsVisible
              ? (boardData?.epics.length ?? 0)
              : tasks.length
        }
        countKind={archiveVisible ? 'archive' : epicsVisible ? 'epics' : 'board'}
        connected={
          archiveVisible
            ? !streamDown && !archive.fetchFailed
            : epicsVisible
              ? !streamDown && !board.fetchFailed
              : connected
        }
        lastSyncedAt={archiveVisible ? archive.lastSyncedAt : board.lastSyncedAt}
        note={archiveVisible ? undefined : STATUS_NOTE[view]}
      />
      {dialog && operation && (
        <ActionDialog
          key={`${operation.id}:${operation.projectId}`}
          action={dialog}
          projectId={operation.projectId}
          onClose={() => operations.end(operation.id)}
          onSavingChange={(saving) =>
            saving ? operations.saveStarted(operation.id) : operations.saveFailed(operation.id)
          }
          tasks={tasks}
          epicApi={
            dialog.kind === 'epic'
              ? epicApi(operation.projectId, dialog.epic.id, () =>
                  refreshProject(operation.projectId),
                )
              : undefined
          }
          onOpenTask={(taskId) => {
            // The epic dialog closes and the board shows the task in the detail panel.
            operations.end(operation.id);
            dispatch({ type: 'SET_VIEW_MODE', mode: 'board' });
            dispatch({ type: 'SELECT_CARD', id: taskId });
          }}
          onSubmit={async (data) => {
            // Writes go to the project the form was opened in, not to whatever the URL says now.
            const projectId = operation.projectId;
            if (dialog.kind === 'create') {
              await createNewTask(projectId, {
                title: data.title ?? '',
                description: data.description ?? '',
                assignee: data.assignee as Assignee,
                isDraft: data.isDraft,
                requestId: data.requestId,
                attachments: data.attachments,
              });
            } else if (dialog.kind === 'move') {
              await moveTask(
                projectId,
                dialog.task.id,
                dialog.target as ColumnName,
                data.reason ?? '',
              );
              if (dialog.target === 'done') taskAnswers.clearTask(projectId, dialog.task.id);
            } else if (dialog.kind === 'edit')
              if (data.attachments || data.removedAttachmentIds?.length)
                await editTaskMultipart(projectId, dialog.task.id, {
                  title: data.title,
                  description: data.description,
                  finalize: data.finalize,
                  requestId: data.requestId,
                  attachments: data.attachments ?? [],
                  removedAttachmentIds: data.removedAttachmentIds,
                });
              else
                await editTask(projectId, dialog.task.id, {
                  title: data.title,
                  description: data.description,
                  body: data.body,
                  acceptance: data.acceptance,
                  finalize: data.finalize,
                });
            refreshProject(projectId);
          }}
        />
      )}
      {session.bulkArchive && (
        <BulkArchiveDialog
          projectName={
            projects.projects.find((project) => project.id === session.bulkArchive?.projectId)
              ?.name ?? t('project.none')
          }
          targets={session.bulkArchive.targets}
          saving={session.operation?.kind === 'archive-done' && session.operation.saving}
          onCancel={() => {
            if (session.operation?.kind === 'archive-done') operations.end(session.operation.id);
            dispatch({ type: 'CLOSE_BULK_ARCHIVE' });
          }}
          onConfirm={async () => {
            const bulkArchive = session.bulkArchive;
            if (!bulkArchive) return;
            const result = await archiveLifecycle.run(
              'archive-done',
              bulkArchive.projectId,
              { taskIds: bulkArchive.targets.map((task) => task.id) },
              { keepOperationOnError: true },
            );
            if (!result.ok) {
              throw new Error(
                result.error instanceof WriteError && result.error.status === 409
                  ? t('archive.bulkConflict')
                  : t('archive.error'),
              );
            }
            dispatch({ type: 'CLOSE_BULK_ARCHIVE' });
            refreshProject(bulkArchive.projectId);
          }}
        />
      )}
    </div>
  );
}
