import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Board } from './components/Board';
import { DetailPanel } from './components/DetailPanel';
import { Header } from './components/Header';
import { ResizeHandle } from './components/ResizeHandle';
import { StatusBar } from './components/StatusBar';
import { useDetailWidth } from './hooks/useDetailWidth';
import { useBoard } from './hooks/useBoard';
import { findCard, nextSelection } from './lib/board';

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

  const cards = board?.cards ?? [];
  const boardName = board?.board.name ?? null;
  const selected = findCard(cards, selectedId);

  useEffect(() => {
    if (board) setSelectedId((current) => nextSelection(board.cards, current));
  }, [board]);

  useEffect(() => {
    document.title = boardName !== null ? `${boardName} - SimpleKanban` : 'SimpleKanban';
  }, [boardName]);

  const isMockCard = selected !== null && selected.id === mockInitial?.select;

  return (
    <div className="app">
      <Header boardName={boardName} />
      <div
        className="app__body"
        ref={bodyRef}
        style={{ '--detail-width': `${width}px` } as CSSProperties}
      >
        <Board
          status={status}
          cards={cards}
          selectedId={selected?.id ?? null}
          onSelect={setSelectedId}
          onRetry={reload}
        />
        <ResizeHandle startDrag={startDrag} moveDrag={moveDrag} endDrag={endDrag} />
        <DetailPanel
          card={selected}
          onClose={() => setSelectedId(null)}
          onDeleted={() => {
            setSelectedId(null);
            reload();
          }}
          initialConfirm={isMockCard ? mockInitial?.confirm : undefined}
          initialDeleteFailed={isMockCard ? mockInitial?.deleteFail : undefined}
        />
      </div>
      <StatusBar
        status={status}
        cardCount={cards.length}
        connected={connected}
        lastSyncedAt={lastSyncedAt}
      />
    </div>
  );
}
