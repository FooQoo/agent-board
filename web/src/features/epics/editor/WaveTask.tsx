import { GripVerticalIcon } from 'lucide-react';
import type { TaskSummary } from '../../../shared/api/contracts';
import { GRIP_CLASS, cardSensors } from '../../../shared/lib/gesture/sortableDrag';
import { useSortable } from '@dnd-kit/react/sortable';
import type { ProgressTaskRenderer } from './progressTypes';

/**
 * A task card inside a wave. The whole card is the draggable, as on the board; a finger on the grip
 * starts a drag at once, and elsewhere it holds for a moment so that a swipe still scrolls the row.
 */
export function WaveTask({
  task,
  index,
  group,
  disabled,
  onOpenTask,
  renderTask,
}: {
  task: TaskSummary;
  index: number;
  group: string;
  disabled: boolean;
  onOpenTask: (taskId: number) => void;
  renderTask: ProgressTaskRenderer;
}) {
  const { ref, isDragging } = useSortable({
    id: `task-${task.id}`,
    index,
    group,
    type: 'task',
    accept: 'task',
    data: { kind: 'task', taskId: task.id },
    sensors: cardSensors,
    disabled,
  });
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
          <span className={`${GRIP_CLASS} epic-progress__grip`} aria-hidden="true">
            <GripVerticalIcon focusable="false" />
          </span>
        ),
        disabled,
        onOpen: () => onOpenTask(task.id),
      })}
    </li>
  );
}
