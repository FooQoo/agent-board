import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { columnLabel } from '../lib/format';
import { useScrollCue } from '../hooks/useScrollCue';
import type { Card as CardModel, ColumnName } from '../types';
import { Card } from './Card';
import { LaneHeader } from './LaneHeader';
import { useDroppable } from '@dnd-kit/react';

export interface LaneProps {
  column: ColumnName;
  cards: CardModel[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onArchive?: () => void;
  onOpenEpic?: (epicId: string) => void;
}

export function Lane({ column, cards, selectedId, onSelect, onArchive, onOpenEpic }: LaneProps) {
  const { t } = useTranslation();
  const listRef = useRef<HTMLUListElement>(null);
  const more = useScrollCue(listRef, cards);
  const { ref, isDropTarget } = useDroppable({ id: `lane-${column}`, data: { column } });
  return (
    <section
      ref={ref}
      className="lane"
      data-drop-target={isDropTarget ? 'true' : 'false'}
      aria-label={columnLabel(column, t)}
    >
      <LaneHeader column={column} count={cards.length} onArchive={onArchive} />
      <div className="lane__scroll" data-more={more ? 'true' : 'false'}>
        <ul className="lane__cards" ref={listRef}>
          {cards.map((card, index) => (
            <li key={card.id}>
              <Card
                card={card}
                index={index}
                selected={card.id === selectedId}
                onSelect={onSelect}
                onOpenEpic={onOpenEpic}
              />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
