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
import type { BoardMessageKind } from './components/BoardMessage';
import { DetailPanel } from './components/DetailPanel';
import { Header } from './components/Header';
import { ResizeHandle } from './components/ResizeHandle';
import { StatusBar, type StatusBarProps } from './components/StatusBar';
import {
  createCard,
  createCardMultipart,
  editCard,
  editCardMultipart,
  moveCard,
  WriteError,
} from './api';
import { useBoard } from './hooks/useBoard';
import { useArchive } from './hooks/useArchive';
import { useCardLifecycle } from './hooks/useCardLifecycle';
import { useBoardEvents } from './hooks/useBoardEvents';
import { useDetailWidth } from './hooks/useDetailWidth';
import { useProjects } from './hooks/useProjects';
import { findCard, groupCards, nextSelection } from './lib/board';
import { isProjectId } from './lib/projectSession';
import { useProjectSession } from './hooks/useProjectSession';
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
  const { session, dispatch, operations } = useProjectSession(requested, initial?.select ?? null);
  const projects = useProjects();

  const activeId = session.activeProjectId;
  const known =
    isProjectId(activeId) && projects.projects.some((project) => project.id === activeId);
  const board = useBoard(known ? activeId : null);
  const archive = useArchive(session.viewMode === 'archive' && known ? activeId : null);
  const archiveLifecycle = useCardLifecycle(operations);
  const [archiveActionFailed, setArchiveActionFailed] = useState(false);

  // The first visit without a project in the URL shows the first project, replacing the history entry.
  const firstProject = projects.status === 'ready' ? (projects.projects[0] ?? null) : null;
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

  // A deleted project shows up in the list on the next refresh; ask for it right away.
  const reloadProjects = projects.reload;
  useEffect(() => {
    if (board.error === 'not_found') reloadProjects();
  }, [board.error, reloadProjects]);

  const boardData = view === 'board' ? board.board : null;
  const cards = boardData?.cards ?? [];
  const selected = findCard(cards, session.selectedId);
  const archivedSelected =
    archive.data?.cards.find((card) => card.id === session.archiveSelectedId) ?? null;
  const activeName = projects.projects.find((project) => project.id === activeId)?.name ?? null;
  useEffect(() => {
    if (boardData) {
      const next = nextSelection(boardData.cards, session.selectedId);
      if (next !== session.selectedId) dispatch({ type: 'SELECT_CARD', id: next });
    }
  }, [boardData, session.selectedId, dispatch]);
  useEffect(() => {
    if (
      archive.status === 'ready' &&
      session.archiveSelectedId !== null &&
      !archive.data?.cards.some((card) => card.id === session.archiveSelectedId)
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
  );
  const [mockInitial] = useState(initial);
  const isMockCard = selected !== null && selected.id === mockInitial?.select;

  const retry = view === 'projects-error' ? projects.reload : board.reload;
  const message = BOARD_MESSAGE[view] ?? null;
  const connected = !streamDown && !board.fetchFailed && !projects.fetchFailed;
  const dialog = session.dialog;
  const operation = session.operation;
  const barStatus =
    view === 'projects-loading' ? 'loading' : view === 'projects-error' ? 'error' : 'ready';

  return (
    <div className="app">
      <Header
        projects={detailShown ? projects.projects : null}
        activeProjectId={known ? activeId : null}
        switchDisabled={operation !== null}
        onSelectProject={(projectId) => {
          setArchiveActionFailed(false);
          void setRequested(projectId, { history: 'push' });
        }}
        canAdd={view === 'board' && session.viewMode === 'board'}
        viewMode={session.viewMode}
        onBack={() => {
          setArchiveActionFailed(false);
          dispatch({ type: 'SET_VIEW_MODE', mode: 'board' });
        }}
        onAdd={() => openDialog({ kind: 'create' })}
        onArchive={() => {
          setArchiveActionFailed(false);
          dispatch({ type: 'SET_VIEW_MODE', mode: 'archive' });
        }}
      />
      <div
        className="app__body"
        data-detail={detailShown ? 'shown' : 'hidden'}
        ref={bodyRef}
        style={{ '--detail-width': `${width}px` } as CSSProperties}
      >
        {archiveVisible ? (
          <ArchiveList
            data={archive.data}
            status={archive.status}
            fetchFailed={archive.fetchFailed}
            actionError={archiveActionFailed}
            selectedId={session.archiveSelectedId}
            onSelect={(id) => dispatch({ type: 'SELECT_ARCHIVE_CARD', id })}
            onRetry={archive.reload}
            layoutRef={attachLayoutRef}
          />
        ) : (
          <Board
            message={message}
            cards={cards}
            selectedId={selected?.id ?? null}
            onSelect={(id) => dispatch({ type: 'SELECT_CARD', id })}
            onRetry={retry}
            layoutRef={attachLayoutRef}
            onMove={(card, column) => openDialog({ kind: 'move', card, target: column })}
            onArchiveDone={() => {
              if (!isProjectId(activeId) || session.operation !== null) return;
              operations.begin('archive-done', activeId);
              dispatch({
                type: 'OPEN_BULK_ARCHIVE',
                projectId: activeId,
                targets: groupCards(cards).done,
              });
            }}
          />
        )}
        {detailShown && (
          <>
            <ResizeHandle startDrag={startDrag} moveDrag={moveDrag} endDrag={endDrag} />
            <DetailPanel
              projectId={known ? activeId : null}
              card={archiveVisible ? archivedSelected : selected}
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
              onEdit={() => {
                if (selected?.isDraft) openDialog({ kind: 'edit', card: selected });
              }}
              onChanged={() => {
                if (isProjectId(activeId)) refreshProject(activeId);
              }}
              archived={archiveVisible}
              onRestore={() => {
                if (!isProjectId(activeId) || archivedSelected === null) return;
                setArchiveActionFailed(false);
                void archiveLifecycle
                  .run('restore', activeId, { cardId: archivedSelected.id })
                  .then((result) => {
                    if (!result.ok) {
                      setArchiveActionFailed(true);
                      return;
                    }
                    dispatch({ type: 'SELECT_ARCHIVE_CARD', id: null });
                    archive.reload();
                    refreshProject(activeId);
                  });
              }}
              onClose={() =>
                dispatch({
                  type: session.viewMode === 'archive' ? 'SELECT_ARCHIVE_CARD' : 'SELECT_CARD',
                  id: null,
                })
              }
              onDeleted={() => {
                dispatch({
                  type: session.viewMode === 'archive' ? 'SELECT_ARCHIVE_CARD' : 'SELECT_CARD',
                  id: null,
                });
                if (isProjectId(activeId)) {
                  refreshProject(activeId);
                  if (session.viewMode === 'archive') archive.reload();
                }
              }}
              initialConfirm={isMockCard ? mockInitial?.confirm : undefined}
              initialDeleteFailed={isMockCard ? mockInitial?.deleteFail : undefined}
            />
          </>
        )}
      </div>
      <StatusBar
        status={archiveVisible ? archive.status : barStatus}
        cardCount={archiveVisible ? (archive.data?.cards.length ?? 0) : cards.length}
        countKind={archiveVisible ? 'archive' : 'board'}
        connected={archiveVisible ? !streamDown && !archive.fetchFailed : connected}
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
          onSubmit={async (data) => {
            // Writes go to the project the form was opened in, not to whatever the URL says now.
            const projectId = operation.projectId;
            if (dialog.kind === 'create')
              if (data.attachments?.length)
                await createCardMultipart(projectId, {
                  title: data.title ?? '',
                  description: data.description ?? '',
                  assignee: data.assignee as Assignee,
                  requestId: data.requestId,
                  attachments: data.attachments,
                });
              else
                await createCard(projectId, {
                  title: data.title ?? '',
                  description: data.description ?? '',
                  assignee: data.assignee as Assignee,
                });
            else if (dialog.kind === 'move')
              await moveCard(
                projectId,
                dialog.card.id,
                dialog.target as ColumnName,
                data.reason ?? '',
              );
            else if (dialog.kind === 'edit')
              if (data.attachments || data.removedAttachmentIds?.length)
                await editCardMultipart(projectId, dialog.card.id, {
                  title: data.title,
                  description: data.description,
                  finalize: data.finalize,
                  requestId: data.requestId,
                  attachments: data.attachments ?? [],
                  removedAttachmentIds: data.removedAttachmentIds,
                });
              else
                await editCard(projectId, dialog.card.id, {
                  title: data.title,
                  description: data.description,
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
              { cardIds: bulkArchive.targets.map((card) => card.id) },
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
