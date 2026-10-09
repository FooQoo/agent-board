import { groupCards } from '../lib/board';
import type { Card, ColumnName } from '../types';
import { BoardMessage, type BoardMessageKind } from './BoardMessage';
import { Lane } from './Lane';
import { DragDropProvider } from '@dnd-kit/react';

const COLUMNS: ColumnName[] = ['todo', 'doing', 'done'];

export interface BoardProps {
  /** A state shown in place of the lanes; `null` shows the lanes. */
  message: Exclude<BoardMessageKind, 'empty'> | null;
  cards: Card[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onRetry: () => void;
  onMove: (card: Card, column: ColumnName) => void;
  onArchiveDone?: () => void;
  layoutRef?: (node: HTMLDivElement | null) => void;
}

export function Board({
  message,
  cards,
  selectedId,
  onSelect,
  onRetry,
  onMove,
  onArchiveDone,
  layoutRef,
}: BoardProps) {
  if (message !== null) {
    return (
      <main className="board board--centered">
        <BoardMessage kind={message} onRetry={onRetry} />
      </main>
    );
  }

  const groups = groupCards(cards);
  return (
    <DragDropProvider
      onDragEnd={(event) => {
        if (event.canceled) return;
        const cardId = event.operation.source?.data.cardId;
        const column = event.operation.target?.data.column;
        const card = cards.find((item) => item.id === cardId);
        if (
          card &&
          (column === 'todo' || column === 'doing' || column === 'done') &&
          card.cardStatus !== column
        )
          onMove(card, column);
      }}
    >
      <main className="board">
        <div className="board__lanes" ref={layoutRef}>
          {COLUMNS.map((column) => (
            <Lane
              key={column}
              column={column}
              cards={groups[column]}
              selectedId={selectedId}
              onSelect={onSelect}
              onArchive={column === 'done' ? onArchiveDone : undefined}
            />
          ))}
        </div>
        {cards.length === 0 && <BoardMessage kind="empty" />}
      </main>
    </DragDropProvider>
  );
}
