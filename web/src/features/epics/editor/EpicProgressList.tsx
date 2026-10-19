import { GripVerticalIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { DragDropProvider } from '@dnd-kit/react';
import { isSortable, useSortable } from '@dnd-kit/react/sortable';
import type { Task } from '../../../shared/api/contracts';

/** What a row gives the caller to draw a task: the drag handle to place, and the row's actions. */
export interface ProgressTaskRow {
  /** The grip a person drags the row by; the caller puts it where it fits. */
  grip: ReactNode;
  disabled: boolean;
  onOpen: () => void;
}

export type ProgressTaskRenderer = (task: Task, row: ProgressTaskRow) => ReactNode;

/**
 * The progress table of an epic: its tasks in the order they are worked on. Dragging a row changes
 * only this order; it does not move the task between columns. The order is saved with the dialog.
 */
export function EpicProgressList({
  tasks,
  disabled,
  onMove,
  onOpenTask,
  renderTask,
}: {
  /** The tasks of this epic in their current order. */
  tasks: readonly Task[];
  disabled: boolean;
  /** The new order: the moved task goes from `from` to `to` in the list. */
  onMove: (from: number, to: number) => void;
  onOpenTask: (taskId: number) => void;
  /** Draws what a row shows for a task. The caller supplies it; the row keeps the drag handle. */
  renderTask: ProgressTaskRenderer;
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
                renderTask={renderTask}
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
  renderTask,
}: {
  task: Task;
  index: number;
  disabled: boolean;
  onOpenTask: (taskId: number) => void;
  renderTask: ProgressTaskRenderer;
}) {
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
      {renderTask(task, {
        grip: (
          <span ref={handleRef} className="epic-progress__grip" aria-hidden="true">
            <GripVerticalIcon focusable="false" />
          </span>
        ),
        disabled,
        onOpen: () => onOpenTask(task.id),
      })}
    </li>
  );
}
