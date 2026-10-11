import { useTranslation } from 'react-i18next';
import { formatShort, stateLabel } from '../lib/format';
import { epicInk } from '../lib/epic';
import type { Card as CardModel } from '../types';
import { GripVerticalIcon, LayersIcon } from 'lucide-react';
import { AssigneeLabel } from './AssigneeLabel';
import { StatusLabel } from './StatusLabel';
import { useDraggable } from '@dnd-kit/react';

export interface CardProps {
  card: CardModel;
  selected: boolean;
  onSelect: (id: number) => void;
  /** The EPIC-ID label was pressed. The epic editor is connected here; without it nothing opens. */
  onOpenEpic?: (epicId: string) => void;
}

const noop = () => {};

/**
 * A board card. The card is the draggable, selectable area (the drag library gives it the button role); the
 * EPIC-ID label is a button of its own, so a press on it opens the epic and does not select the card.
 */
export function Card({ card, selected, onSelect, onOpenEpic = noop }: CardProps) {
  const { t } = useTranslation();
  const showsState = stateLabel(card, t) !== null;
  const pending = showsState && card.agentStatus === 'pending';
  const { ref, isDragging } = useDraggable({ id: `card-${card.id}`, data: { cardId: card.id } });
  const epic = card.epic;
  const className = [
    'card',
    pending ? 'card--pending' : '',
    selected ? 'card--selected' : '',
    isDragging ? 'card--dragging' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      ref={ref}
      className={className}
      role="button"
      tabIndex={0}
      aria-current={selected ? 'true' : 'false'}
      onClick={() => onSelect(card.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && event.target === event.currentTarget) onSelect(card.id);
      }}
    >
      <span className="card__top">
        <GripVerticalIcon aria-hidden="true" focusable="false" className="grip" />
        <span className="card__id">#{card.id}</span>
        <AssigneeLabel assignee={card.assignee} />
        {card.isDraft && <span className="card__draft">{t('draft.label')}</span>}
        <span className="card__spacer" />
        {showsState && <StatusLabel kind="agent" status={card.agentStatus} />}
      </span>
      <span className="card__title">{card.title}</span>
      {epic && (
        <button
          type="button"
          className="card__epic"
          data-epic-label={epic.id}
          style={{ background: epic.color, color: epicInk(epic.color) }}
          title={epic.name}
          onClick={(event) => {
            event.stopPropagation();
            onOpenEpic(epic.id);
          }}
        >
          <LayersIcon aria-hidden="true" focusable="false" />
          <span>{epic.id}</span>
        </button>
      )}
      {pending && card.pendingReason && <span className="card__reason">{card.pendingReason}</span>}
      <span className="card__updated">
        {t('card.updated', { date: formatShort(card.updatedAt) })}
      </span>
    </div>
  );
}
