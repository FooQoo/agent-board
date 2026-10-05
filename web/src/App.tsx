import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { Board } from './components/Board';
import { DetailPanel } from './components/DetailPanel';
import { Header } from './components/Header';
import { ResizeHandle } from './components/ResizeHandle';
import { StatusBar } from './components/StatusBar';
import { useDetailWidth } from './hooks/useDetailWidth';
import { useBoard } from './hooks/useBoard';
import { findCard, nextSelection } from './lib/board';
import { ActionDialog, type DialogAction } from './components/ActionDialog';
import { answerRequest, createCard, moveCard } from './api';
import type { Assignee, ColumnName } from './types';

export interface AppProps {
  /** Mock mode only: initial UI state taken from the page URL (see `src/mock.ts`). */
  initial?: { select?: number; confirm?: boolean; deleteFail?: boolean };
}

export function App({ initial }: AppProps) {
  const { status, board, connected, lastSyncedAt, reload } = useBoard();
  const [selectedId, setSelectedId] = useState<number | null>(initial?.select ?? null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const { width, startDrag, moveDrag, endDrag } = useDetailWidth(bodyRef, status === 'ready');
  const [mockInitial] = useState(initial);
  const [dialog, setDialog] = useState<DialogAction | null>(null);

  const cards = board?.cards ?? [];
  const boardName = board?.board.name ?? null;
  const selected = findCard(cards, selectedId);

  useEffect(() => {
    if (board) setSelectedId((current) => nextSelection(board.cards, current));
  }, [board]);

  // A layout effect, so the title is already set when the board name appears in the DOM.
  useLayoutEffect(() => {
    document.title = boardName !== null ? `${boardName} - Agent Board` : 'Agent Board';
  }, [boardName]);

  const isMockCard = selected !== null && selected.id === mockInitial?.select;

  return (
    <div className="app">
      <Header boardName={boardName} onAdd={() => setDialog({ kind: 'create' })} />
      <div
        className="app__body"
        data-status={status}
        ref={bodyRef}
        style={{ '--detail-width': `${width}px` } as CSSProperties}
      >
        <Board
          status={status}
          cards={cards}
          selectedId={selected?.id ?? null}
          onSelect={setSelectedId}
          onRetry={reload}
          onMove={(card, column) => setDialog({ kind: 'move', card, target: column })}
        />
        {status === 'ready' && (
          <>
            <ResizeHandle startDrag={startDrag} moveDrag={moveDrag} endDrag={endDrag} />
            <DetailPanel
              card={selected}
              onAnswer={() => {
                if (selected) setDialog({ kind: 'answer', card: selected });
              }}
              onClose={() => setSelectedId(null)}
              onDeleted={() => {
                setSelectedId(null);
                reload();
              }}
              initialConfirm={isMockCard ? mockInitial?.confirm : undefined}
              initialDeleteFailed={isMockCard ? mockInitial?.deleteFail : undefined}
            />
          </>
        )}
      </div>
      <StatusBar
        status={status}
        cardCount={cards.length}
        connected={connected}
        lastSyncedAt={lastSyncedAt}
      />
      {dialog && (
        <ActionDialog
          key={
            dialog.kind === 'move'
              ? `move-${dialog.card.id}-${dialog.target}`
              : dialog.kind === 'answer'
                ? `answer-${dialog.card.id}`
                : 'create'
          }
          action={dialog}
          onClose={() => setDialog(null)}
          onSubmit={async (data) => {
            if (dialog.kind === 'create')
              await createCard({
                title: data.title ?? '',
                description: data.description ?? '',
                assignee: data.assignee as Assignee,
              });
            else if (dialog.kind === 'move')
              await moveCard(dialog.card.id, dialog.target as ColumnName, data.reason ?? '');
            else
              await answerRequest(
                dialog.card.id,
                dialog.card.pendingRequestId ?? '',
                data.reason ?? '',
              );
            reload();
          }}
        />
      )}
    </div>
  );
}
