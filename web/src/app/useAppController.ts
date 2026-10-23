import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { parseAsString, useQueryState } from 'nuqs';
import { useBoard } from '../pages/board/model/useBoard';
import { useArchive } from '../pages/archive/model/useArchive';
import { useProjects } from '../features/projects/model/useProjects';
import { useTaskLifecycle } from '../features/tasks/model/useTaskLifecycle';
import { useBuildReload } from './model/useBuildReload';
import { usePcConnection } from './data/PcData';
import { epicForEditor, taskForEditor, toBoardView } from './data/assemble';
import { useDataCore, usePresentationHold } from '../shared/data/react';
import { useDetailWidth } from '../shared/lib/detail-width/useDetailWidth';
import { useProjectSession } from './model/useProjectSession';
import { useTaskAnswers } from '../features/tasks/answer/model/useTaskAnswers';
import { findTask, nextSelection } from '../features/tasks/model/board';
import { isProjectId } from './model/projectSession';
import { STALE_PAGE_EVENT } from './api';
import { preloadBoardCode } from './dialogs/lazyDialogs';
import type { AppControllerModel, AppInitial, AppView } from './contracts';
import type { DialogAction, Epic, ProjectId, Task, TaskSummary } from '../shared/api/contracts';
import type { ResourceKey } from '../shared/data/core';

const BOARD_MESSAGE: Partial<Record<AppView, AppControllerModel['message']>> = {
  'projects-loading': 'loading',
  'projects-error': 'error',
  'no-projects': 'noProjects',
  resolving: 'switching',
  'not-found': 'notFound',
  'board-loading': 'switching',
  'board-error': 'boardError',
};

export function useAppController(initial: AppInitial | undefined): AppControllerModel {
  const [requested, setRequested] = useQueryState('project', parseAsString);
  const { session, dispatch, operations, answerLeaseControls } = useProjectSession(
    requested,
    initial?.select ?? null,
  );
  // The dialog belongs to the project it was opened in: another project closes it.
  const [docsOpenFor, setDocsOpenFor] = useState<ProjectId | null>(null);
  const taskAnswers = useTaskAnswers(answerLeaseControls.set);
  const projects = useProjects();
  const activeId = session.activeProjectId;
  useEffect(() => {
    if (docsOpenFor !== null && docsOpenFor !== activeId) setDocsOpenFor(null);
  }, [docsOpenFor, activeId]);
  const known =
    isProjectId(activeId) && projects.projects.some((project) => project.id === activeId);
  const core = useDataCore();
  const { adapter, serverBuild, streamDown } = usePcConnection();
  const board = useBoard(known ? activeId : null);
  const archive = useArchive(session.viewMode === 'archive' && known ? activeId : null);
  const archiveLifecycle = useTaskLifecycle(operations);
  const [restoreFailure, setRestoreFailure] = useState<{
    projectId: ProjectId;
    taskId: number;
  } | null>(null);
  const [stalePage, setStalePage] = useState(false);

  const firstProject = projects.status === 'ready' ? (projects.projects[0] ?? null) : null;
  useEffect(() => {
    const onStale = () => setStalePage(true);
    window.addEventListener(STALE_PAGE_EVENT, onStale);
    return () => window.removeEventListener(STALE_PAGE_EVENT, onStale);
  }, []);
  useEffect(() => {
    if (requested === null && firstProject !== null && session.operation === null)
      void setRequested(firstProject.id, { history: 'replace' });
  }, [requested, firstProject, session.operation, setRequested]);

  let view: AppView;
  if (projects.status === 'loading') view = 'projects-loading';
  else if (projects.status === 'error') view = 'projects-error';
  else if (projects.projects.length === 0) view = 'no-projects';
  else if (activeId === null) view = 'resolving';
  else if (!known || board.error === 'not_found') view = 'not-found';
  else if (board.status === 'ready') view = 'board';
  else view = board.status === 'error' ? 'board-error' : 'board-loading';

  const archiveVisible = session.viewMode === 'archive' && known && view !== 'not-found';
  const epicsVisible = session.viewMode === 'epics' && known && view !== 'not-found';
  const reloadProjects = projects.reload;
  useEffect(() => {
    if (board.error === 'not_found') reloadProjects();
  }, [board.error, reloadProjects]);

  const boardView = useMemo(
    () => (board.summary ? toBoardView(board.summary) : null),
    [board.summary],
  );
  const boardData = view === 'board' ? boardView : null;
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
  const listedEpic = boardData?.epics.find((epic) => epic.id === session.epicSelectedId) ?? null;
  const selectedEpic = listedEpic;
  useEffect(() => {
    if (boardData && session.epicSelectedId !== null && listedEpic === null)
      dispatch({ type: 'SELECT_EPIC', id: null });
  }, [boardData, session.epicSelectedId, listedEpic, dispatch]);
  useEffect(() => {
    if (
      archive.status === 'ready' &&
      session.archiveSelectedId !== null &&
      !archive.data?.tasks.some((task) => task.id === session.archiveSelectedId)
    )
      dispatch({ type: 'SELECT_ARCHIVE_CARD', id: null });
  }, [archive.data, archive.status, session.archiveSelectedId, dispatch]);

  useLayoutEffect(() => {
    document.title = activeName !== null ? `${activeName} - Agent Board` : 'Agent Board';
  }, [activeName]);

  const activeRef = useRef(activeId);
  activeRef.current = activeId;
  // A write is shown at once: the Summary is read again without waiting for the presentation hold,
  // and the Details it names as changed follow in the same pass.
  const refreshProject = useCallback(
    (projectId: ProjectId) => {
      if (activeRef.current === projectId) void core.refreshSummary(projectId);
    },
    [core],
  );
  const reloadArchive = archive.reload;
  // The editors start from the whole text, so the Detail is read again just before they open: a
  // body that is still loading, or older than the file, would be saved over the real one.
  const loadTask = useCallback(
    async (projectId: ProjectId, card: TaskSummary): Promise<Task | null> => {
      const key: ResourceKey = { kind: 'task', projectId, id: card.id };
      await core.refreshDetail(key, ['document']);
      const loaded = core.store.getResource(key).document.data;
      return loaded === null ? null : taskForEditor(card, loaded);
    },
    [core],
  );
  const loadEpic = useCallback(
    async (projectId: ProjectId, epic: Epic): Promise<Epic | null> => {
      const key: ResourceKey = { kind: 'epic', projectId, id: epic.id };
      await core.refreshDetail(key, ['document']);
      const loaded = core.store.getResource(key).document.data;
      return loaded === null ? null : epicForEditor(epic, loaded);
    },
    [core],
  );

  // The lists the data core does not own are read again when the stream says they changed. The
  // archive list waits like the Summary while a drawer or a modal is open; the project list is
  // not what a drawer or a modal shows, so it does not wait.
  const reloadProjectsRef = useRef(reloadProjects);
  reloadProjectsRef.current = reloadProjects;
  const reloadArchiveRef = useRef(reloadArchive);
  reloadArchiveRef.current = reloadArchive;
  useEffect(
    () =>
      adapter.subscribe((note) => {
        if (note.type === 'sync') {
          reloadProjectsRef.current();
          core.gate.submit(() => reloadArchiveRef.current(), { key: 'archive' });
          return;
        }
        const { event } = note;
        if (event.changes.some((change) => change.resource === 'project'))
          reloadProjectsRef.current();
        if (event.projectId === activeRef.current)
          core.gate.submit(() => reloadArchiveRef.current(), { key: 'archive' });
      }),
    [adapter, core],
  );

  // Automatic updates wait while the detail drawer or a modal is open and for 3 seconds after.
  usePresentationHold(
    session.selectedId !== null ||
      session.archiveSelectedId !== null ||
      session.epicSelectedId !== null,
    'drawer',
  );
  usePresentationHold(
    session.operation !== null || session.dialog !== null || session.bulkArchive !== null,
    'modal',
  );
  useBuildReload(
    serverBuild,
    session.operation !== null || session.answerLeases.length > 0,
    core.gate,
  );
  useEffect(preloadBoardCode, []);
  const openDialog = useCallback(
    (dialog: DialogAction) => {
      if (session.operation !== null || !isProjectId(activeId)) return;
      operations.begin(dialog.kind === 'request' ? 'create' : dialog.kind, activeId, dialog);
    },
    [activeId, operations, session.operation],
  );

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

  return {
    session,
    dispatch,
    operations,
    projects,
    board,
    archive,
    answerSession: taskAnswers,
    tasks,
    selected,
    archivedSelected,
    selectedEpic,
    activeId,
    activeName,
    known,
    boardData,
    view,
    archiveVisible,
    epicsVisible,
    detailShown,
    stalePage,
    isMockTask,
    mockInitial,
    barStatus:
      projects.status === 'loading' ? 'loading' : projects.status === 'error' ? 'error' : 'ready',
    message: BOARD_MESSAGE[view] ?? null,
    retry,
    connected: !streamDown && !board.fetchFailed && !projects.fetchFailed,
    streamDown,
    width,
    bodyRef,
    attachLayoutRef,
    startDrag,
    moveDrag,
    endDrag,
    archiveLifecycle,
    openDialog,
    refreshProject,
    loadTask,
    loadEpic,
    setRequested,
    restoreFailure,
    setRestoreFailure,
    projectName: (projectId) => projects.projects.find((project) => project.id === projectId)?.name,
    viewMode: session.viewMode,
    docsProjectId: docsOpenFor === activeId ? docsOpenFor : null,
    setDocsProjectId: setDocsOpenFor,
  };
}
