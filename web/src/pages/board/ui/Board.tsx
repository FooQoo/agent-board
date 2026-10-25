import { groupTasks } from '../../../features/tasks/model/board';
import type { TaskSummary, ColumnName } from '../../../shared/api/contracts';
import { BoardMessage, type BoardMessageKind } from './BoardMessage';
import { Lane } from './Lane';
import { DragDropProvider } from '@dnd-kit/react';
import { isSortable } from '@dnd-kit/react/sortable';
import type { ProjectId } from '../../../shared/api/contracts';
import type { TaskAnswerController } from '../../../features/tasks/answer/model/useTaskAnswers';

const COLUMNS: ColumnName[] = ['todo', 'doing', 'done'];

export interface BoardProps {
  /** A state shown in place of the lanes; `null` shows the lanes. */
  message: Exclude<BoardMessageKind, 'empty'> | null;
  tasks: TaskSummary[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onRetry: () => void;
  onMove: (task: TaskSummary, column: ColumnName) => void;
  /** A card was dropped in another place of its own lane: just before `beforeId`, or at the end. */
  onReorder?: (task: TaskSummary, beforeId: number | null) => void;
  onArchiveDone?: () => void;
  /** The EPIC-ID label of a card was pressed. */
  onOpenEpic?: (epicId: string) => void;
  projectId?: ProjectId;
  answers?: TaskAnswerController;
  syncedAt?: Date | null;
  onAnswerChanged?: () => void;
  layoutRef?: (node: HTMLDivElement | null) => void;
}

export function Board({
  message,
  tasks,
  selectedId,
  onSelect,
  onRetry,
  onMove,
  onReorder,
  onArchiveDone,
  onOpenEpic,
  projectId,
  answers,
  syncedAt,
  onAnswerChanged,
  layoutRef,
}: BoardProps) {
  if (message !== null) {
    return (
      <main className="board board--centered">
        <BoardMessage kind={message} onRetry={onRetry} />
      </main>
    );
  }

  const groups = groupTasks(tasks);
  // Reset the drag controller when cards change lanes so its retained source element cannot
  // remain beside the newly rendered card. Edits and same-lane reordering keep the controller.
  const laneMembership = tasks
    .map((task) => `${task.id}:${task.taskStatus}`)
    .sort()
    .join('|');
  return (
    <DragDropProvider
      key={laneMembership}
      onDragOver={(event) => {
        // Cards sort only inside their own lane. Another lane is a move, which waits for its reason, so
        // the card must not be shown there before it is confirmed.
        const { source, target } = event.operation;
        if (source && target && source.data.column !== target.data.column) event.preventDefault();
      }}
      onDragEnd={(event) => {
        if (event.canceled) return;
        const taskId = event.operation.source?.data.taskId;
        const source = event.operation.source;
        const column: unknown = event.operation.target?.data.column;
        const task = tasks.find((item) => item.id === taskId);
        if (!task || !(column === 'todo' || column === 'doing' || column === 'done')) return;
        if (task.taskStatus !== column) {
          // The drag drops the focus from the card. Give it back first, so the dialog returns to the card.
          if (source?.element instanceof HTMLElement) source.element.focus();
          onMove(task, column);
          return;
        }
        if (!onReorder || !source || !isSortable(source)) return;
        const { initialIndex, index } = source.sortable;
        if (initialIndex === index) return;
        const others = groups[column].filter((item) => item.id !== task.id);
        onReorder(task, others[index]?.id ?? null);
      }}
    >
      <main className="board">
        <div className="board__lanes" ref={layoutRef}>
          {COLUMNS.map((column) => (
            <Lane
              key={column}
              column={column}
              tasks={groups[column]}
              selectedId={selectedId}
              onSelect={onSelect}
              onArchive={column === 'done' ? onArchiveDone : undefined}
              onOpenEpic={onOpenEpic}
              projectId={projectId}
              answers={answers}
              syncedAt={syncedAt}
              onAnswerChanged={onAnswerChanged}
            />
          ))}
        </div>
        {tasks.length === 0 && <BoardMessage kind="empty" />}
      </main>
    </DragDropProvider>
  );
}
