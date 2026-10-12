import { groupCards } from '../lib/board';
import type { Card, ColumnName } from '../types';
import { BoardMessage, type BoardMessageKind } from './BoardMessage';
import { Lane } from './Lane';
import { DragDropProvider } from '@dnd-kit/react';
import { isSortable } from '@dnd-kit/react/sortable';

const COLUMNS: ColumnName[] = ['todo', 'doing', 'done'];

export interface BoardProps {
  /** A state shown in place of the lanes; `null` shows the lanes. */
  message: Exclude<BoardMessageKind, 'empty'> | null;
  cards: Card[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onRetry: () => void;
  onMove: (card: Card, column: ColumnName) => void;
  /** A card was dropped in another place of its own lane: just before `beforeId`, or at the end. */
  onReorder?: (card: Card, beforeId: number | null) => void;
  onArchiveDone?: () => void;
  /** The EPIC-ID label of a card was pressed. */
  onOpenEpic?: (epicId: string) => void;
  layoutRef?: (node: HTMLDivElement | null) => void;
}

export function Board({
  message,
  cards,
  selectedId,
  onSelect,
  onRetry,
  onMove,
  onReorder,
  onArchiveDone,
  onOpenEpic,
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
      onDragOver={(event) => {
        // The sorting would move the card's element inside the list the page renders, which React does not
        // know about. The card stays where it is until the new order is saved and the board is read again.
        event.preventDefault();
      }}
      onDragEnd={(event) => {
        if (event.canceled) return;
        const cardId = event.operation.source?.data.cardId;
        const source = event.operation.source;
        const column: unknown = event.operation.target?.data.column;
        const card = cards.find((item) => item.id === cardId);
        if (!card || !(column === 'todo' || column === 'doing' || column === 'done')) return;
        if (card.cardStatus !== column) {
          onMove(card, column);
          return;
        }
        const target = event.operation.target;
        if (!onReorder || !source || !target || target.id === source.id) return;
        // Dropped on a card of the lane: the card takes that card's place. Dropped on the lane itself: the end.
        const targetIndex = isSortable(target) ? target.sortable.index : groups[column].length;
        const others = groups[column].filter((item) => item.id !== card.id);
        onReorder(card, others[targetIndex]?.id ?? null);
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
              onOpenEpic={onOpenEpic}
            />
          ))}
        </div>
        {cards.length === 0 && <BoardMessage kind="empty" />}
      </main>
    </DragDropProvider>
  );
}
