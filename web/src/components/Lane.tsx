import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { columnLabel } from '../lib/format';
import { useScrollCue } from '../hooks/useScrollCue';
import type { Task as TaskModel, ColumnName } from '../types';
import { TaskCard } from './TaskCard';
import { LaneHeader } from './LaneHeader';
import { useDroppable } from '@dnd-kit/react';
import type { ProjectId } from '../types';
import type { TaskAnswerController } from '../hooks/useTaskAnswers';

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
  return (
    <section
      ref={ref}
      className="lane"
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
              onOpenEpic={onOpenEpic}
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
