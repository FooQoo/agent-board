import { useTranslation } from 'react-i18next';
import { columnLabel } from '../lib/format';
import type { Card as CardModel, ColumnName } from '../types';
import { Card } from './Card';
import { LaneHeader } from './LaneHeader';

export interface LaneProps {
  column: ColumnName;
  cards: CardModel[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}

export function Lane({ column, cards, selectedId, onSelect }: LaneProps) {
  const { t } = useTranslation();
  return (
    <section className="lane" aria-label={columnLabel(column, t)}>
      <LaneHeader column={column} count={cards.length} />
      <ul className="lane__cards">
        {cards.map((card) => (
          <li key={card.id}>
            <Card card={card} selected={card.id === selectedId} onSelect={onSelect} />
          </li>
        ))}
      </ul>
    </section>
  );
}
