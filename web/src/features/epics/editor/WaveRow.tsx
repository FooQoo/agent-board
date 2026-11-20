import { GripHorizontalIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDroppable } from '@dnd-kit/react';
import { useSortable } from '@dnd-kit/react/sortable';
import type { TaskSummary } from '../../../shared/api/contracts';
import { cardSensors } from '../../../shared/lib/gesture/sortableDrag';
import type { ProgressTaskRenderer } from './progressTypes';
import { WaveTask } from './WaveTask';
import type { WaveStatus } from './waveModel';

/** The text of a wave's status: done, in progress, or the tasks it waits for. */
function useStatusText(status: WaveStatus): string {
  const { t } = useTranslation();
  if (status.kind === 'done') return t('epic.waveDone');
  if (status.kind === 'active') return t('epic.waveActive');
  return t('epic.waveWaiting', { ids: status.blockers.map((id) => `#${id}`).join(', ') });
}

/** The row of task cards of one group: the drop area of that group, scrolling sideways. */
export function WaveTasks({
  group,
  tasks,
  disabled,
  onOpenTask,
  renderTask,
}: {
  group: string;
  tasks: readonly TaskSummary[];
  disabled: boolean;
  onOpenTask: (taskId: number) => void;
  renderTask: ProgressTaskRenderer;
}) {
  const { ref, isDropTarget } = useDroppable({
    id: `drop-${group}`,
    accept: 'task',
    data: { group },
  });
  return (
    <ul
      ref={ref}
      className="epic-wave__tasks"
      data-drop-target={isDropTarget ? 'true' : 'false'}
      data-group={group}
    >
      {tasks.map((task, index) => (
        <WaveTask
          key={task.id}
          task={task}
          index={index}
          group={group}
          disabled={disabled}
          onOpenTask={onOpenTask}
          renderTask={renderTask}
        />
      ))}
    </ul>
  );
}

/**
 * One wave: a header with the wave's grip, its number, its size and its status, and the row of its
 * tasks. The header's grip moves the whole wave up and down; the cards move between waves.
 */
export function WaveRow({
  number,
  index,
  group,
  tasks,
  status,
  disabled,
  onOpenTask,
  renderTask,
}: {
  number: number;
  index: number;
  group: string;
  tasks: readonly TaskSummary[];
  status: WaveStatus;
  disabled: boolean;
  onOpenTask: (taskId: number) => void;
  renderTask: ProgressTaskRenderer;
}) {
  const { t } = useTranslation();
  const statusText = useStatusText(status);
  const { ref, handleRef, isDragging } = useSortable({
    id: `wave-item-${index}`,
    index,
    type: 'wave',
    accept: 'wave',
    data: { kind: 'wave' },
    sensors: cardSensors,
    disabled,
  });
  return (
    <li
      ref={ref}
      className={isDragging ? 'epic-wave is-dragging' : 'epic-wave'}
      data-status={status.kind}
      aria-label={t('epic.waveLabel', { n: number })}
    >
      <div className="epic-wave__head">
        <button
          type="button"
          ref={handleRef}
          className="epic-wave__grip"
          aria-label={t('epic.waveMove', { n: number })}
        >
          <GripHorizontalIcon aria-hidden="true" focusable="false" />
        </button>
        <span className="epic-wave__title">{t('epic.wave', { n: number })}</span>
        {tasks.length > 1 && (
          <span className="epic-wave__count">
            {t('epic.waveParallel', { count: tasks.length })}
          </span>
        )}
        <span className="epic-wave__status">{statusText}</span>
      </div>
      <WaveTasks
        group={group}
        tasks={tasks}
        disabled={disabled}
        onOpenTask={onOpenTask}
        renderTask={renderTask}
      />
    </li>
  );
}
