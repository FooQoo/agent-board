import { groupCards } from '../lib/board';
import type { Card, ColumnName } from '../types';
import { BoardMessage } from './BoardMessage';
import { Lane } from './Lane';

const COLUMNS: ColumnName[] = ['todo', 'doing', 'done'];

export interface BoardProps {
  status: 'loading' | 'ready' | 'error';
  cards: Card[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onRetry: () => void;
}

export function Board({ status, cards, selectedId, onSelect, onRetry }: BoardProps) {
  if (status !== 'ready') {
    return (
      <main className="board board--centered">
        <BoardMessage kind={status} onRetry={onRetry} />
      </main>
    );
  }

  const groups = groupCards(cards);
  return (
    <main className="board">
      <div className="board__lanes">
        {COLUMNS.map((column) => (
          <Lane key={column} column={column} cards={groups[column]} selectedId={selectedId} onSelect={onSelect} />
        ))}
      </div>
      {cards.length === 0 && <BoardMessage kind="empty" />}
    </main>
  );
}
