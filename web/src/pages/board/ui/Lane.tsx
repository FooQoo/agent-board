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
import { BacklogBar } from '../../../features/backlog/BacklogBar';
import type { BacklogSelection } from '../../../features/backlog/useSelection';

export interface LaneProps {
  column: ColumnName;
  /** A card is being dragged over the lane or one of its cards. */
  hovered?: boolean;
  tasks: TaskModel[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onArchive?: () => void;
  onOpenEpic?: (epicId: string) => void;
  projectId?: ProjectId;
  onAnswer?: (taskId: number) => void;
  /** The Backlog lane: the selection mode and the send of the picked cards. */
  backlog?: {
    selection: BacklogSelection;
    busy: boolean;
    onSend: (ids: number[]) => void;
    /** The picked cards are being dragged: the card under the pointer. */
    draggingId: number | null;
  };
}

export function Lane({
  column,
  hovered = false,
  tasks,
  selectedId,
  onSelect,
  onArchive,
  onOpenEpic,
  projectId,
  onAnswer,
  backlog,
}: LaneProps) {
  const { t } = useTranslation();
  const listRef = useRef<HTMLDivElement>(null);
  const more = useScrollCue(listRef, tasks);
  const { ref, isDropTarget } = useDroppable({
    id: `lane-${column}`,
    data: { column, group: column },
  });
  // The card draws no epic label of its own; the board puts the epic's label on it.
  const renderEpic = (epic: EpicRef) => (
    <EpicLabel
      epic={epic}
      className="card__epic"
      stopPropagation
      onClick={() => onOpenEpic?.(epic.id)}
    />
  );
  const picking = backlog?.selection.selecting === true;
  return (
    <section
      ref={ref}
      className="lane"
      data-column={column}
      data-drop-target={isDropTarget || hovered ? 'true' : 'false'}
      aria-label={columnLabel(column, t)}
    >
      <LaneHeader
        column={column}
        count={tasks.length}
        onArchive={onArchive}
        selecting={backlog?.selection.selecting}
        onToggleSelect={
          backlog
            ? backlog.selection.selecting
              ? backlog.selection.leave
              : backlog.selection.enter
            : undefined
        }
      />
      <div className="lane__scroll" data-more={more ? 'true' : 'false'}>
        <div className="lane__cards" ref={listRef}>
          {tasks.length === 0 && column === 'backlog' && (
            <p className="lane__empty">{t('backlog.empty')}</p>
          )}
          {tasks.map((task, index) => (
            <TaskCard
              key={task.id}
              task={task}
              index={index}
              selected={task.id === selectedId}
              onSelect={picking ? backlog.selection.toggle : onSelect}
              selection={
                picking
                  ? {
                      checked: backlog.selection.picked.includes(task.id),
                      onToggle: () => backlog.selection.toggle(task.id),
                      drag:
                        backlog.draggingId !== null &&
                        backlog.selection.picked.includes(backlog.draggingId) &&
                        backlog.selection.picked.includes(task.id)
                          ? {
                              count: backlog.selection.picked.length,
                              lead: task.id === backlog.draggingId,
                            }
                          : undefined,
                    }
                  : undefined
              }
              renderEpic={renderEpic}
              projectId={projectId}
              onAnswer={onAnswer}
            />
          ))}
        </div>
      </div>
      {picking && (
        <BacklogBar
          variant="lane"
          count={backlog.selection.picked.length}
          busy={backlog.busy}
          onCancel={backlog.selection.leave}
          onSend={() => backlog.onSend(backlog.selection.picked)}
        />
      )}
    </section>
  );
}
