import { useTranslation } from 'react-i18next';
import { formatShort, stateLabel } from '../lib/format';
import type { Card as CardModel } from '../types';
import { GripVerticalIcon } from 'lucide-react';
import { AssigneeLabel } from './AssigneeLabel';
import { StatusLabel } from './StatusLabel';
import { useDraggable } from '@dnd-kit/react';

export interface CardProps {
  card: CardModel;
  selected: boolean;
  onSelect: (id: number) => void;
}

export function Card({ card, selected, onSelect }: CardProps) {
  const { t } = useTranslation();
  const showsState = stateLabel(card, t) !== null;
  const pending = showsState && card.agentStatus === 'pending';
  const { ref, isDragging } = useDraggable({ id: `card-${card.id}`, data: { cardId: card.id } });
  const className = [
    'card',
    pending ? 'card--pending' : '',
    selected ? 'card--selected' : '',
    isDragging ? 'card--dragging' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      ref={ref}
      type="button"
      className={className}
      aria-current={selected ? 'true' : 'false'}
      onClick={() => onSelect(card.id)}
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
      {pending && card.pendingReason && <span className="card__reason">{card.pendingReason}</span>}
      <span className="card__updated">
        {t('card.updated', { date: formatShort(card.updatedAt) })}
      </span>
    </button>
  );
}
