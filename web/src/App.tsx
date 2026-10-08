import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { parseAsString, useQueryState } from 'nuqs';
import { ActionDialog } from './components/ActionDialog';
import { Board } from './components/Board';
import type { BoardMessageKind } from './components/BoardMessage';
import { DetailPanel } from './components/DetailPanel';
import { Header } from './components/Header';
import { ResizeHandle } from './components/ResizeHandle';
import { StatusBar, type StatusBarProps } from './components/StatusBar';
import { createCard, createCardMultipart, editCard, editCardMultipart, moveCard } from './api';
import { useBoard } from './hooks/useBoard';
import { useBoardEvents } from './hooks/useBoardEvents';
import { useDetailWidth } from './hooks/useDetailWidth';
import { useProjects } from './hooks/useProjects';
import { findCard, nextSelection } from './lib/board';
import {
  initSession,
  isProjectId,
  sessionReducer,
  type OperationControls,
  type OperationKind,
} from './lib/projectSession';
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
  const [requested, setRequested] = useQueryState('project', parseAsString);
  const [session, dispatch] = useReducer(sessionReducer, undefined, () =>
    initSession(requested, initial?.select ?? null),
  );
  const projects = useProjects();

  const activeId = session.activeProjectId;
  const known =
    isProjectId(activeId) && projects.projects.some((project) => project.id === activeId);
  const board = useBoard(known ? activeId : null);

  // The URL is the request; the reducer decides when it is applied.
  useEffect(() => {
    dispatch({ type: 'URL_REQUESTED', projectId: requested });
  }, [requested]);

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

  // A deleted project shows up in the list on the next refresh; ask for it right away.
  const reloadProjects = projects.reload;
  useEffect(() => {
    if (board.error === 'not_found') reloadProjects();
  }, [board.error, reloadProjects]);

  const boardData = view === 'board' ? board.board : null;
  const cards = boardData?.cards ?? [];
  const selected = findCard(cards, session.selectedId);
  const activeName = projects.projects.find((project) => project.id === activeId)?.name ?? null;

  useEffect(() => {
    if (boardData) {
      const next = nextSelection(boardData.cards, session.selectedId);
      if (next !== session.selectedId) dispatch({ type: 'SELECT_CARD', id: next });
    }
  }, [boardData, session.selectedId]);

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
    }, [reloadProjects, reloadBoard]),
  );

  const nextOperationId = useRef(0);
  const operations: OperationControls = useMemo(
    () => ({
      begin: (kind: OperationKind, projectId: ProjectId, dialog?: DialogAction) => {
        const operationId = ++nextOperationId.current;
        dispatch({ type: 'OPEN_OPERATION', operationId, kind, projectId, dialog });
        return operationId;
      },
      saveStarted: (operationId) => dispatch({ type: 'SAVE_STARTED', operationId }),
      saveFailed: (operationId) => dispatch({ type: 'SAVE_FAILED', operationId }),
      end: (operationId) => dispatch({ type: 'OPERATION_CANCELLED', operationId }),
      cardDeleted: (operationId, projectId, cardId) =>
        dispatch({ type: 'CARD_DELETED', operationId, projectId, cardId }),
    }),
    [],
  );

  const openDialog = (dialog: DialogAction) => {
    if (session.operation !== null || !isProjectId(activeId)) return;
    operations.begin(dialog.kind, activeId, dialog);
  };

  const detailShown = view !== 'projects-loading' && view !== 'projects-error';
  const bodyRef = useRef<HTMLDivElement>(null);
  const { width, startDrag, moveDrag, endDrag } = useDetailWidth(
    bodyRef,
    `${detailShown}:${view === 'board'}`,
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
        onSelectProject={(projectId) => void setRequested(projectId, { history: 'push' })}
        canAdd={view === 'board'}
        onAdd={() => openDialog({ kind: 'create' })}
      />
      <div
        className="app__body"
        data-detail={detailShown ? 'shown' : 'hidden'}
        ref={bodyRef}
        style={{ '--detail-width': `${width}px` } as CSSProperties}
      >
        <Board
          message={message}
          cards={cards}
          selectedId={selected?.id ?? null}
          onSelect={(id) => dispatch({ type: 'SELECT_CARD', id })}
          onRetry={retry}
          onMove={(card, column) => openDialog({ kind: 'move', card, target: column })}
        />
        {detailShown && (
          <>
            <ResizeHandle startDrag={startDrag} moveDrag={moveDrag} endDrag={endDrag} />
            <DetailPanel
              projectId={known ? activeId : null}
              card={selected}
              variant={view === 'board' ? 'card' : 'state'}
              operations={operations}
              onEdit={() => {
                if (selected?.isDraft) openDialog({ kind: 'edit', card: selected });
              }}
              onChanged={() => {
                if (isProjectId(activeId)) refreshProject(activeId);
              }}
              onClose={() => dispatch({ type: 'SELECT_CARD', id: null })}
              onDeleted={() => {
                if (isProjectId(activeId)) refreshProject(activeId);
              }}
              initialConfirm={isMockCard ? mockInitial?.confirm : undefined}
              initialDeleteFailed={isMockCard ? mockInitial?.deleteFail : undefined}
            />
          </>
        )}
      </div>
      <StatusBar
        status={barStatus}
        cardCount={cards.length}
        connected={connected}
        lastSyncedAt={board.lastSyncedAt}
        note={STATUS_NOTE[view]}
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
    </div>
  );
}
