import { formatShort, stateLabel } from '../lib/format';
import type { Card as CardModel } from '../types';
import { Grip } from './icons';
import { RunStateBadge } from './RunStateBadge';

export interface CardProps {
  card: CardModel;
  selected: boolean;
  onSelect: (id: number) => void;
}

export function Card({ card, selected, onSelect }: CardProps) {
  const showsState = stateLabel(card) !== null;
  const pending = showsState && card.run_state === 'pending';
  const className = ['card', pending ? 'card--pending' : '', selected ? 'card--selected' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <button type="button" className={className} aria-pressed={selected} onClick={() => onSelect(card.id)}>
      <span className="card__top">
        <Grip />
        <span className="card__id">#{card.id}</span>
        <span className="card__spacer" />
        {showsState && <RunStateBadge state={card.run_state} />}
      </span>
      <span className="card__title">{card.title}</span>
      {pending && card.pending_reason && <span className="card__reason">{card.pending_reason}</span>}
      <span className="card__updated">Updated {formatShort(card.updated_at)}</span>
    </button>
  );
}
