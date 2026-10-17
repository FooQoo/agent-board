import { GripVerticalIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { DragDropProvider } from '@dnd-kit/react';
import { isSortable, useSortable } from '@dnd-kit/react/sortable';
import { AcceptanceProgress } from '../acceptance/AcceptanceProgress';
import { AssigneeLabel } from '../AssigneeLabel';
import { StatusLabel } from '../StatusLabel';
import { TaskCardContent } from '../TaskCard';
import { formatShort } from '../../lib/format';
import type { Task } from '../../types';

/**
 * The progress table of an epic: its tasks in the order they are worked on. Dragging a row changes
 * only this order; it does not move the task between columns. The order is saved with the dialog.
 */
export function EpicProgressList({
  tasks,
  disabled,
  onMove,
  onOpenTask,
}: {
  /** The tasks of this epic in their current order. */
  tasks: readonly Task[];
  disabled: boolean;
  /** The new order: the moved task goes from `from` to `to` in the list. */
  onMove: (from: number, to: number) => void;
  onOpenTask: (taskId: number) => void;
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
      {tasks.length === 0 ? (
        <p className="epic-progress__empty">{t('epic.progressEmpty')}</p>
      ) : (
        <>
          <p className="epic-progress__hint">{t('epic.progressReorder')}</p>
          <ol className="epic-progress__list" aria-label={t('epic.progressTitle')}>
            {tasks.map((task, index) => (
              <ProgressRow
                key={task.id}
                task={task}
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
  task,
  index,
  disabled,
  onOpenTask,
}: {
  task: Task;
  index: number;
  disabled: boolean;
  onOpenTask: (taskId: number) => void;
}) {
  const { t } = useTranslation();
  const { ref, handleRef, isDragging } = useSortable({ id: task.id, index, disabled });
  return (
    <li
      ref={ref}
      className={[
        'epic-progress__row',
        'card',
        task.agentStatus === 'pending' && task.taskStatus !== 'done' ? 'card--pending' : '',
        isDragging ? 'is-dragging' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-task-id={task.id}
    >
      <div className="card__top">
        <span ref={handleRef} className="epic-progress__grip" aria-hidden="true">
          <GripVerticalIcon focusable="false" />
        </span>
        <span className="card__id">#{task.id}</span>
        <AssigneeLabel assignee={task.assignee} />
        {task.isDraft && <span className="card__draft">{t('draft.label')}</span>}
        <span className="card__spacer" />
        <StatusLabel
          kind={task.taskStatus === 'done' ? 'card' : 'agent'}
          status={task.taskStatus === 'done' ? 'done' : task.agentStatus}
        />
      </div>
      <TaskCardContent
        task={task}
        titleClassName="card__title epic-progress__name"
        titleActionDisabled={disabled}
        onTitleClick={() => onOpenTask(task.id)}
        showPendingReason={false}
      />
      <div className="card__foot epic-progress__foot">
        <span className="card__updated">
          {t('card.updated', { date: formatShort(task.updatedAt) })}
        </span>
        <AcceptanceProgress task={task} />
      </div>
    </li>
  );
}
