import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { columnLabel } from '../lib/format';
import { useScrollCue } from '../hooks/useScrollCue';
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
  const listRef = useRef<HTMLUListElement>(null);
  const more = useScrollCue(listRef, cards);
  return (
    <section className="lane" aria-label={columnLabel(column, t)}>
      <LaneHeader column={column} count={cards.length} />
      <div className="lane__scroll" data-more={more ? 'true' : 'false'}>
        <ul className="lane__cards" ref={listRef}>
          {cards.map((card) => (
            <li key={card.id}>
              <Card card={card} selected={card.id === selectedId} onSelect={onSelect} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
