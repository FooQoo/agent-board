import { GripVerticalIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { DragDropProvider } from '@dnd-kit/react';
import { isSortable, useSortable } from '@dnd-kit/react/sortable';
import { AcceptanceProgress } from '../acceptance/AcceptanceProgress';
import { AssigneeLabel } from '../AssigneeLabel';
import { StatusLabel } from '../StatusLabel';
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
  const { ref, handleRef, isDragging } = useSortable({ id: card.id, index, disabled });
  return (
    <li
      ref={ref}
      className={isDragging ? 'epic-progress__row is-dragging' : 'epic-progress__row'}
      data-task-id={card.id}
    >
      <span ref={handleRef} className="epic-progress__grip" aria-hidden="true">
        <GripVerticalIcon focusable="false" />
      </span>
      <div className="epic-progress__body">
        <div className="epic-progress__meta">
          <span className="epic-progress__id">#{card.id}</span>
          <AssigneeLabel assignee={card.assignee} />
          <StatusLabel kind="card" status={card.cardStatus} />
        </div>
        <button
          type="button"
          className="epic-progress__name"
          disabled={disabled}
          onClick={() => onOpenTask(card.id)}
        >
          {card.title}
        </button>
        <div className="epic-progress__foot">
          <AcceptanceProgress card={card} />
        </div>
      </div>
    </li>
  );
}
