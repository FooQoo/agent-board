import { GripVerticalIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { DragDropProvider } from '@dnd-kit/react';
import { isSortable, useSortable } from '@dnd-kit/react/sortable';
import { AcceptanceProgress } from '../acceptance/AcceptanceProgress';
import { AssigneeLabel } from '../AssigneeLabel';
import { StatusLabel } from '../StatusLabel';
import { CardContent } from '../Card';
import { formatShort } from '../../lib/format';
import type { Card } from '../../types';

/**
 * The progress table of an epic: its tasks in the order they are worked on. Dragging a row changes
 * only this order; it does not move the task between columns. The order is saved with the dialog.
 */
export function EpicProgressList({
  cards,
  disabled,
  onMove,
  onOpenTask,
}: {
  /** The tasks of this epic in their current order. */
  cards: readonly Card[];
  disabled: boolean;
  /** The new order: the moved task goes from `from` to `to` in the list. */
  onMove: (from: number, to: number) => void;
  onOpenTask: (cardId: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <DragDropProvider
      onDragEnd={(event) => {
        if (event.canceled) return;
        const source = event.operation.source;
        if (!source || !isSortable(source)) return;
        const from = source.sortable.initialIndex;
        const to = source.sortable.index;
        if (from !== to) onMove(from, to);
      }}
    >
      {cards.length === 0 ? (
        <p className="epic-progress__empty">{t('epic.progressEmpty')}</p>
      ) : (
        <>
          <p className="epic-progress__hint">{t('epic.progressReorder')}</p>
          <ol className="epic-progress__list" aria-label={t('epic.progressTitle')}>
            {cards.map((card, index) => (
              <ProgressRow
                key={card.id}
                card={card}
                index={index}
                disabled={disabled}
                onOpenTask={onOpenTask}
              />
            ))}
          </ol>
          <p className="epic-progress__hint">{t('epic.progressSaveOrder')}</p>
        </>
      )}
    </DragDropProvider>
  );
}

function ProgressRow({
  card,
  index,
  disabled,
  onOpenTask,
}: {
  card: Card;
  index: number;
  disabled: boolean;
  onOpenTask: (cardId: number) => void;
}) {
  const { t } = useTranslation();
  const { ref, handleRef, isDragging } = useSortable({ id: card.id, index, disabled });
  return (
    <li
      ref={ref}
      className={[
        'epic-progress__row',
        'card',
        card.agentStatus === 'pending' && card.cardStatus !== 'done' ? 'card--pending' : '',
        isDragging ? 'is-dragging' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-task-id={card.id}
    >
      <div className="card__top">
        <span ref={handleRef} className="epic-progress__grip" aria-hidden="true">
          <GripVerticalIcon focusable="false" />
        </span>
        <span className="card__id">#{card.id}</span>
        <AssigneeLabel assignee={card.assignee} />
        {card.isDraft && <span className="card__draft">{t('draft.label')}</span>}
        <span className="card__spacer" />
        <StatusLabel
          kind={card.cardStatus === 'done' ? 'card' : 'agent'}
          status={card.cardStatus === 'done' ? 'done' : card.agentStatus}
        />
      </div>
      <CardContent
        card={card}
        titleClassName="card__title epic-progress__name"
        titleActionDisabled={disabled}
        onTitleClick={() => onOpenTask(card.id)}
        showPendingReason={false}
      />
      <div className="card__foot epic-progress__foot">
        <span className="card__updated">
          {t('card.updated', { date: formatShort(card.updatedAt) })}
        </span>
        <AcceptanceProgress card={card} />
      </div>
    </li>
  );
}
