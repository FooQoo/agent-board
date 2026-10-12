import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { columnLabel } from '../lib/format';
import { useScrollCue } from '../hooks/useScrollCue';
import type { Card as CardModel, ColumnName } from '../types';
import { Card } from './Card';
import { LaneHeader } from './LaneHeader';
import { useDroppable } from '@dnd-kit/react';
import type { ProjectId } from '../types';
import type { CardAnswerController } from '../hooks/useCardAnswers';

export interface LaneProps {
  column: ColumnName;
  cards: CardModel[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onArchive?: () => void;
  onOpenEpic?: (epicId: string) => void;
  projectId?: ProjectId;
  answers?: CardAnswerController;
  syncedAt?: Date | null;
  onAnswerChanged?: () => void;
}

export function Lane({
  column,
  cards,
  selectedId,
  onSelect,
  onArchive,
  onOpenEpic,
  projectId,
  answers,
  syncedAt,
  onAnswerChanged,
}: LaneProps) {
  const { t } = useTranslation();
  const listRef = useRef<HTMLDivElement>(null);
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
        <div className="lane__cards" ref={listRef}>
          {cards.map((card, index) => (
            <Card
              key={card.id}
              card={card}
              index={index}
              selected={card.id === selectedId}
              onSelect={onSelect}
              onOpenEpic={onOpenEpic}
              projectId={projectId}
              answers={answers}
              syncedAt={syncedAt}
              onAnswerChanged={onAnswerChanged}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
