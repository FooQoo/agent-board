import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';
import { formatShort, stateLabel } from '../lib/format';
import { AcceptanceProgress } from './acceptance/AcceptanceProgress';
import type { Card as CardModel } from '../types';
import { GripVerticalIcon } from 'lucide-react';
import { EpicLabel } from './EpicLabel';
import { AssigneeLabel } from './AssigneeLabel';
import { StatusLabel } from './StatusLabel';
import { useSortable } from '@dnd-kit/react/sortable';
import { DecisionRequestForm } from './detail/DecisionRequestForm';
import { noOperations } from '../lib/projectSession';
import type { CardAnswerController } from '../hooks/useCardAnswers';
import type { ProjectId } from '../types';
import '../styles/card-answer.css';

export interface CardProps {
  card: CardModel;
  selected: boolean;
  onSelect: (id: number) => void;
  /** The card's place in its lane, in the order the board shows. */
  index?: number;
  /** The EPIC-ID label was pressed. The epic editor is connected here; without it nothing opens. */
  onOpenEpic?: (epicId: string) => void;
  projectId?: ProjectId;
  answers?: CardAnswerController;
  syncedAt?: Date | null;
  onAnswerChanged?: () => void;
}

export function CardContent({
  card,
  titleClassName = 'card__title',
  reasonClassName = 'card__reason',
  showPendingReason = card.agentStatus === 'pending',
  titleActionDisabled,
  onTitleClick,
  children,
}: {
  card: CardModel;
  titleClassName?: string;
  reasonClassName?: string;
  showPendingReason?: boolean;
  /** Optional title action for monitor detail navigation. */
  titleActionDisabled?: boolean;
  onTitleClick?: () => void;
  children?: ReactNode;
}) {
  return (
    <>
      {titleActionDisabled !== undefined ? (
        <button
          type="button"
          className={titleClassName}
          disabled={titleActionDisabled}
          onClick={onTitleClick}
        >
          {card.title}
        </button>
      ) : (
        <span className={titleClassName}>{card.title}</span>
      )}
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
export function Card({
  card,
  selected,
  index = 0,
  onSelect,
  onOpenEpic = noop,
  projectId,
  answers,
  syncedAt = null,
  onAnswerChanged,
}: CardProps) {
  const { t } = useTranslation();
  const showsState = stateLabel(card, t) !== null;
  const pending = showsState && card.agentStatus === 'pending';
  const showInlineAnswer = Boolean(projectId && answers && pending);
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
    <div className="card__item" role="group" tabIndex={-1}>
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
          <AcceptanceProgress card={card} />
        </span>
        <CardContent card={card} showPendingReason={pending && !showInlineAnswer}>
          {epic && (
            <EpicLabel
              epic={epic}
              className="card__epic"
              stopPropagation
              onClick={() => onOpenEpic(epic.id)}
            />
          )}
        </CardContent>
        <span className="card__foot">
          <span className="card__updated">
            {t('card.updated', { date: formatShort(card.updatedAt) })}
          </span>
        </span>
      </div>
      {projectId && answers && showInlineAnswer && (
        <div className="card__answer" data-card-id={card.id}>
          <DecisionRequestForm
            projectId={projectId}
            card={card}
            operations={noOperations}
            stateStore={answers.stateStore}
            writeAnswer={answers.writeAnswer}
            disabled={answers.wasAnswered(projectId, card.id, card.pendingRequestId)}
            onChanged={onAnswerChanged}
            onAnswered={(result) =>
              card.pendingRequestId &&
              answers.onAnswered(projectId, card.id, card.pendingRequestId, result, syncedAt)
            }
          />
        </div>
      )}
    </div>
  );
}
