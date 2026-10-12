import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';
import { formatShort, stateLabel } from '../lib/format';
import { AcceptanceProgress } from './acceptance/AcceptanceProgress';
import { epicInk } from '../lib/epic';
import type { Card as CardModel } from '../types';
import { GripVerticalIcon, LayersIcon } from 'lucide-react';
import { AssigneeLabel } from './AssigneeLabel';
import { StatusLabel } from './StatusLabel';
import { useSortable } from '@dnd-kit/react/sortable';

export interface CardProps {
  card: CardModel;
  selected: boolean;
  onSelect: (id: number) => void;
  /** The card's place in its lane, in the order the board shows. */
  index?: number;
  /** The EPIC-ID label was pressed. The epic editor is connected here; without it nothing opens. */
  onOpenEpic?: (epicId: string) => void;
}

export function CardContent({
  card,
  titleClassName = 'card__title',
  reasonClassName = 'card__reason',
  showPendingReason = card.agentStatus === 'pending',
  children,
}: {
  card: CardModel;
  titleClassName?: string;
  reasonClassName?: string;
  showPendingReason?: boolean;
  children?: ReactNode;
}) {
  return (
    <>
      <span className={titleClassName}>{card.title}</span>
      {children}
      {showPendingReason && card.pendingReason && (
        <span className={reasonClassName}>{card.pendingReason}</span>
      )}
    </>
  );
}

const noop = () => {};

/**
 * A board card. It is a direct child of its lane's card container, so the sorting moves it among its
 * siblings and the lane keeps its gaps. The card is the draggable, selectable area (the drag library gives it the button role); the
 * EPIC-ID label is a button of its own, so a press on it opens the epic and does not select the card.
 */
export function Card({ card, selected, index = 0, onSelect, onOpenEpic = noop }: CardProps) {
  const { t } = useTranslation();
  const showsState = stateLabel(card, t) !== null;
  const pending = showsState && card.agentStatus === 'pending';
  const { ref, isDragging } = useSortable({
    id: `card-${card.id}`,
    index,
    group: card.cardStatus,
    data: { cardId: card.id, column: card.cardStatus },
  });
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
      <CardContent card={card} showPendingReason={pending}>
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
      </CardContent>
      <span className="card__foot">
        <span className="card__updated">
          {t('card.updated', { date: formatShort(card.updatedAt) })}
        </span>
        <AcceptanceProgress card={card} />
      </span>
    </div>
  );
}
