import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { columnLabel } from '../../../features/tasks/model/format';
import { useScrollCue } from '../../../shared/lib/scroll/useScrollCue';
import type { TaskSummary as TaskModel, ColumnName, EpicRef } from '../../../shared/api/contracts';
import { EpicLabel } from '../../../features/epics/label/EpicLabel';
import { TaskCard } from '../../../features/tasks/card/TaskCard';
import { LaneHeader } from './LaneHeader';
import { useDroppable } from '@dnd-kit/react';
import type { ProjectId } from '../../../shared/api/contracts';
import type { TaskAnswerController } from '../../../features/tasks/answer/model/useTaskAnswers';

export interface LaneProps {
  column: ColumnName;
  tasks: TaskModel[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onArchive?: () => void;
  onOpenEpic?: (epicId: string) => void;
  projectId?: ProjectId;
  answers?: TaskAnswerController;
  syncedAt?: Date | null;
  onAnswerChanged?: () => void;
}

export function Lane({
  column,
  tasks,
  selectedId,
  onSelect,
  onArchive,
  onOpenEpic,
  projectId,
  answers,
  syncedAt,
  onAnswerChanged,
}: LaneProps) {
  const { t } = useTranslation();
  const listRef = useRef<HTMLDivElement>(null);
  const more = useScrollCue(listRef, tasks);
  const { ref, isDropTarget } = useDroppable({ id: `lane-${column}`, data: { column } });
  // The card draws no epic label of its own; the board puts the epic's label on it.
  const renderEpic = (epic: EpicRef) => (
    <EpicLabel
      epic={epic}
      className="card__epic"
      stopPropagation
      onClick={() => onOpenEpic?.(epic.id)}
    />
  );
  return (
    <section
      ref={ref}
      className="lane"
      data-column={column}
      data-drop-target={isDropTarget ? 'true' : 'false'}
      aria-label={columnLabel(column, t)}
    >
      <LaneHeader column={column} count={tasks.length} onArchive={onArchive} />
      <div className="lane__scroll" data-more={more ? 'true' : 'false'}>
        <div className="lane__cards" ref={listRef}>
          {tasks.map((task, index) => (
            <TaskCard
              key={task.id}
              task={task}
              index={index}
              selected={task.id === selectedId}
              onSelect={onSelect}
              renderEpic={renderEpic}
              projectId={projectId}
              answers={answers}
              syncedAt={syncedAt}
              onAnswerChanged={onAnswerChanged}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
