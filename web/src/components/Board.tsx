import { groupCards } from '../lib/board';
import type { Card, ColumnName } from '../types';
import { BoardMessage, type BoardMessageKind } from './BoardMessage';
import { Lane } from './Lane';
import { DragDropProvider } from '@dnd-kit/react';
import { isSortable } from '@dnd-kit/react/sortable';
import type { ProjectId } from '../types';
import type { CardAnswerController } from '../hooks/useCardAnswers';

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
  projectId?: ProjectId;
  answers?: CardAnswerController;
  syncedAt?: Date | null;
  onAnswerChanged?: () => void;
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
  projectId,
  answers,
  syncedAt,
  onAnswerChanged,
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
  // Reset the drag controller when cards change lanes so its retained source element cannot
  // remain beside the newly rendered card. Edits and same-lane reordering keep the controller.
  const laneMembership = cards
    .map((card) => `${card.id}:${card.cardStatus}`)
    .sort()
    .join('|');
  return (
    <DragDropProvider
      key={laneMembership}
      onDragOver={(event) => {
        // Cards sort only inside their own lane. Another lane is a move, which waits for its reason, so
        // the card must not be shown there before it is confirmed.
        const { source, target } = event.operation;
        if (source && target && source.data.column !== target.data.column) event.preventDefault();
      }}
      onDragEnd={(event) => {
        if (event.canceled) return;
        const cardId = event.operation.source?.data.cardId;
        const source = event.operation.source;
        const column: unknown = event.operation.target?.data.column;
        const card = cards.find((item) => item.id === cardId);
        if (!card || !(column === 'todo' || column === 'doing' || column === 'done')) return;
        if (card.cardStatus !== column) {
          // The drag drops the focus from the card. Give it back first, so the dialog returns to the card.
          if (source?.element instanceof HTMLElement) source.element.focus();
          onMove(card, column);
          return;
        }
        if (!onReorder || !source || !isSortable(source)) return;
        const { initialIndex, index } = source.sortable;
        if (initialIndex === index) return;
        const others = groups[column].filter((item) => item.id !== card.id);
        onReorder(card, others[index]?.id ?? null);
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
              projectId={projectId}
              answers={answers}
              syncedAt={syncedAt}
              onAnswerChanged={onAnswerChanged}
            />
          ))}
        </div>
        {cards.length === 0 && <BoardMessage kind="empty" />}
      </main>
    </DragDropProvider>
  );
}
