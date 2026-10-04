import { useTranslation } from 'react-i18next';
import { formatShort, stateLabel } from '../lib/format';
import type { Card as CardModel } from '../types';
import { Grip } from './icons';
import { RunStateBadge } from './RunStateBadge';
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
        <Grip />
        <span className="card__id">#{card.id}</span>
        <span className="card__spacer" />
        <span className="card__assignee">{t(`assignee.${card.assignee}`)}</span>
        {showsState && <RunStateBadge state={card.agentStatus} />}
      </span>
      <span className="card__title">{card.title}</span>
      {pending && card.pendingReason && <span className="card__reason">{card.pendingReason}</span>}
      <span className="card__updated">
        {t('card.updated', { date: formatShort(card.updatedAt) })}
      </span>
    </button>
  );
}
