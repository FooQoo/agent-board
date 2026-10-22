import { type CSSProperties, Suspense } from 'react';
import { Header } from '../shared/ui/app-header/Header';
import { ProjectSwitcher } from '../features/projects/switcher/ProjectSwitcher';
import { boardSettingsSlot } from './boardSettingsSlot';
import { Board } from '../pages/board/ui/Board';
import { ArchiveList } from '../pages/archive/ui/ArchiveList';
import { EpicList } from '../pages/epics/ui/EpicList';
import { EpicDetailPanel, EpicDetailPlaceholder } from '../pages/epics/ui/EpicDetailPanel';
import { DetailPanel } from '../features/tasks/detail/DetailPanel';
import { ResizeHandle } from '../shared/ui/resize-handle/ResizeHandle';
import { StatusBar } from '../shared/ui/status-bar/StatusBar';
import { StalePageNotice } from '../shared/ui/stale-page-notice/StalePageNotice';
import { guideLayer } from './onboarding/lazyGuide';
import { isProjectId } from './model/projectSession';
import type { ProjectId } from '../shared/api/contracts';
import type { AppControllerModel, AppWorkspaceActions } from './contracts';

export function BoardWorkspace({
  model,
  actions,
  guide = true,
}: {
  model: AppControllerModel;
  actions: AppWorkspaceActions;
  /** Whether the first-run guide may run here; stories leave it off, since they make no requests. */
  guide?: boolean;
}) {
  const {
    session,
    projects,
    board,
    archive,
    tasks,
    selected,
    archivedSelected,
    selectedEpic,
    activeId,
    known,
    boardData,
    archiveVisible,
    epicsVisible,
    detailShown,
    stalePage,
    isMockTask,
    mockInitial,
    barStatus,
    message,
    retry,
    connected,
    streamDown,
    width,
    bodyRef,
    attachLayoutRef,
    startDrag,
    moveDrag,
    endDrag,
    restoreFailure,
  } = model;
  const operation = session.operation;
  const projectSwitcher = (
    <ProjectSwitcher
      projects={projects.projects ?? []}
      activeProjectId={known ? activeId : null}
      disabled={operation !== null || session.answerLeases.length > 0}
      onSelect={actions.onSelectProject}
    />
  );
  return (
    <>
      {stalePage ? <StalePageNotice /> : null}
      <Header
        projects={
          projects.projects.length > 0 || model.view === 'no-projects' ? projects.projects : null
        }
        activeProjectId={known ? activeId : null}
        switchDisabled={operation !== null}
        projectSwitcher={projectSwitcher}
        settings={boardSettingsSlot}
        canAdd={session.viewMode === 'board' && model.view === 'board'}
        viewMode={session.viewMode}
        onBack={actions.onBack}
        onAdd={actions.onAdd}
        onArchive={actions.onArchive}
        onEpics={actions.onEpics}
        onRefresh={actions.onRefresh}
      />
      <div
        className="app__body"
        data-detail={detailShown ? 'shown' : 'hidden'}
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
            onSelect={actions.onSelectEpic}
            onRetry={board.reload}
            layoutRef={attachLayoutRef}
          />
        ) : archiveVisible ? (
          <ArchiveList
            data={archive.data}
            status={archive.status}
            fetchFailed={archive.fetchFailed}
            selectedId={session.archiveSelectedId}
            onSelect={actions.onSelectArchiveCard}
            onRetry={archive.reload}
            layoutRef={attachLayoutRef}
          />
        ) : (
          <Board
            message={message}
            tasks={tasks}
            selectedId={selected?.id ?? null}
            onSelect={actions.onSelectCard}
            onRetry={retry}
            layoutRef={attachLayoutRef}
            projectId={activeId as ProjectId}
            answers={model.answerSession}
            syncedAt={board.lastSyncedAt}
            onAnswerChanged={actions.onAnswerChanged}
            onOpenEpic={actions.onOpenEpic}
            onMove={actions.onMove}
            onReorder={actions.onReorder}
            onArchiveDone={actions.onArchiveDone}
          />
        )}
        {epicsVisible && activeId ? (
          <>
            <ResizeHandle startDrag={startDrag} moveDrag={moveDrag} endDrag={endDrag} />
            {selectedEpic === null ? (
              <EpicDetailPlaceholder />
            ) : (
              <EpicDetailPanel
                projectId={activeId}
                epic={selectedEpic}
                onEdit={actions.onEditEpic}
                operations={model.operations}
                onDelete={actions.onDeleteEpic}
                onClose={actions.onCloseEpic}
              />
            )}
          </>
        ) : null}
        {!epicsVisible && detailShown ? (
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
                  : model.view === 'board'
                    ? 'card'
                    : 'state'
              }
              operations={model.operations}
              problems={archiveVisible ? [] : (boardData?.problems ?? [])}
              epics={archiveVisible ? archive.data?.epics : boardData?.epics}
              epicsFailed={
                archiveVisible
                  ? archive.status === 'error'
                  : boardData === null && Boolean(activeId)
              }
              onRetryEpics={actions.onRetryEpics}
              onEdit={actions.onEditTask}
              onChanged={actions.onTaskChanged}
              archived={archiveVisible}
              operationSaving={operation?.saving ?? false}
              restoreFailed={Boolean(
                restoreFailure?.projectId === activeId &&
                  restoreFailure.taskId === archivedSelected?.id,
              )}
              onRemove={actions.onRemove}
              onRestore={actions.onRestore}
              onClose={actions.onCloseDetails}
              initialConfirm={isMockTask ? mockInitial?.confirm : undefined}
              initialDeleteFailed={isMockTask ? mockInitial?.deleteFail : undefined}
            />
          </>
        ) : null}
      </div>
      <Suspense fallback={null}>
        <guideLayer.Component
          projectId={known && isProjectId(activeId) ? activeId : null}
          eligible={
            guide &&
            known &&
            model.view === 'board' &&
            operation === null &&
            session.answerLeases.length === 0 &&
            !epicsVisible &&
            !archiveVisible &&
            !isMockTask
          }
          tasks={tasks}
          answers={model.answerSession}
          syncedAt={board.lastSyncedAt}
          onAnswerChanged={actions.onAnswerChanged}
        />
      </Suspense>
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
        note={
          archiveVisible
            ? undefined
            : model.view === 'board'
              ? undefined
              : model.view === 'projects-loading' || model.view === 'projects-error'
                ? undefined
                : model.view === 'no-projects'
                  ? 'noProjects'
                  : model.view === 'resolving'
                    ? 'boardLoading'
                    : model.view === 'not-found'
                      ? 'noSelection'
                      : model.view === 'board-loading'
                        ? 'boardLoading'
                        : model.view === 'board-error' && model.barStatus === 'error'
                          ? undefined
                          : 'notSynced'
        }
      />
    </>
  );
}
