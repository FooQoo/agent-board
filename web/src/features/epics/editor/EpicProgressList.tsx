import { PlusIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { DragDropProvider, useDroppable } from '@dnd-kit/react';
import { isSortable } from '@dnd-kit/react/sortable';
import type { TaskSummary } from '../../../shared/api/contracts';
import { dropPlacement } from '../../../shared/lib/gesture/sortableDrag';
import { WaveRow, WaveTasks } from './WaveRow';
import {
  NEW_WAVE_GROUP,
  UNLISTED_GROUP,
  moveTask,
  moveWave,
  targetOfGroup,
  waveGroup,
  waveStatuses,
  type Waves,
} from './waveModel';
import type { ProgressTaskRenderer } from './progressTypes';

export type { ProgressTaskRenderer, ProgressTaskRow } from './progressTypes';

function NewWaveZone() {
  const { t } = useTranslation();
  const { ref, isDropTarget } = useDroppable({
    id: `drop-${NEW_WAVE_GROUP}`,
    accept: 'task',
    data: { group: NEW_WAVE_GROUP },
  });
  return (
    <div ref={ref} className="epic-wave__new" data-drop-target={isDropTarget ? 'true' : 'false'}>
      <PlusIcon aria-hidden="true" focusable="false" />
      {t('epic.waveNew')}
    </div>
  );
}

/**
 * The order of an epic's tasks as waves, top to bottom. A wave's tasks run side by side; a wave
 * starts when the waves above it are Done. Dragging changes only this order, not the task's column.
 * Tasks no wave lists follow in a group of their own and are never held back. The new order is
 * saved with the dialog.
 */
export function EpicProgressList({
  waves,
  unlisted,
  disabled,
  onChange,
  onOpenTask,
  renderTask,
}: {
  /** The tasks of each wave, in order. No wave is empty. */
  waves: readonly (readonly TaskSummary[])[];
  /** The tasks of the epic that no wave lists. */
  unlisted: readonly TaskSummary[];
  disabled: boolean;
  /** The waves after a drop, as task IDs. */
  onChange: (waves: Waves) => void;
  onOpenTask: (taskId: number) => void;
  /** Draws what a card shows for a task. The caller supplies it; the card keeps the drag grip. */
  renderTask: ProgressTaskRenderer;
}) {
  const { t } = useTranslation();
  const ids: Waves = waves.map((wave) => wave.map((task) => task.id));
  const statuses = waveStatuses(ids, waves.flat());
  const empty = waves.length === 0 && unlisted.length === 0;
  const change = (next: Waves) => {
    if (JSON.stringify(next) !== JSON.stringify(ids)) onChange(next);
  };
  return (
    <DragDropProvider
      // A drop rearranges the lists, so the drag controller starts again from the new order.
      key={JSON.stringify(ids)}
      onDragEnd={(event) => {
        if (event.canceled) return;
        const source = event.operation.source;
        if (!source) return;
        if (source.data.kind === 'wave') {
          if (isSortable(source)) {
            change(moveWave(ids, source.sortable.initialIndex, source.sortable.index));
          }
          return;
        }
        const taskId: unknown = source.data.taskId;
        const placement = dropPlacement(event.operation);
        const target = placement && targetOfGroup(placement.group, placement.index);
        if (typeof taskId !== 'number' || !placement || !target || placement.unchanged) return;
        change(moveTask(ids, taskId, target));
      }}
    >
      {empty ? (
        <p className="epic-progress__empty">{t('epic.progressEmpty')}</p>
      ) : (
        <>
          <p className="epic-progress__hint">{t('epic.progressReorder')}</p>
          <ol className="epic-progress__list" aria-label={t('epic.progressTitle')}>
            {waves.map((wave, index) => (
              <WaveRow
                key={waveGroup(index)}
                number={index + 1}
                index={index}
                group={waveGroup(index)}
                tasks={wave}
                status={statuses[index] ?? { kind: 'active' }}
                disabled={disabled}
                onOpenTask={onOpenTask}
                renderTask={renderTask}
              />
            ))}
            {unlisted.length > 0 && (
              <li className="epic-wave epic-wave--unlisted" aria-label={t('epic.unlistedTitle')}>
                <div className="epic-wave__head">
                  <span className="epic-wave__title">{t('epic.unlistedTitle')}</span>
                  <span className="epic-wave__status">{t('epic.unlistedHint')}</span>
                </div>
                <WaveTasks
                  group={UNLISTED_GROUP}
                  tasks={unlisted}
                  disabled={disabled}
                  onOpenTask={onOpenTask}
                  renderTask={renderTask}
                />
              </li>
            )}
            {!disabled && (
              <li className="epic-wave__new-item">
                <NewWaveZone />
              </li>
            )}
          </ol>
          <p className="epic-progress__hint">{t('epic.progressSaveOrder')}</p>
        </>
      )}
    </DragDropProvider>
  );
}
