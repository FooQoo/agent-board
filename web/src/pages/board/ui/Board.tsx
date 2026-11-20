import type { ReactNode } from 'react';
import { groupTasks } from '../../../features/tasks/model/board';
import type { TaskSummary, ColumnName } from '../../../shared/api/contracts';
import { BoardMessage, type BoardMessageKind } from './BoardMessage';
import { Lane } from './Lane';
import { DragDropProvider } from '@dnd-kit/react';
import { dropPlacement } from '../../../shared/lib/gesture/sortableDrag';
import type { ProjectId } from '../../../shared/api/contracts';

const COLUMNS: ColumnName[] = ['todo', 'doing', 'done'];

function isColumn(value: unknown): value is ColumnName {
  return value === 'todo' || value === 'doing' || value === 'done';
}

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
  onAnswer?: (taskId: number) => void;
  layoutRef?: (node: HTMLDivElement | null) => void;
  /** The band of unanswered questions above the lanes. */
  band?: ReactNode;
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
  onAnswer,
  layoutRef,
  band,
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
        const placement = dropPlacement(event.operation);
        const task = tasks.find((item) => item.id === taskId);
        const column = placement?.group;
        if (!task || !placement || !isColumn(column)) return;
        if (task.taskStatus !== column) {
          // The drag drops the focus from the card. Give it back first, so the dialog returns to the card.
          if (source?.element instanceof HTMLElement) source.element.focus();
          onMove(task, column);
          return;
        }
        if (!onReorder || placement.unchanged || placement.index === null) return;
        const others = groups[column].filter((item) => item.id !== task.id);
        onReorder(task, others[placement.index]?.id ?? null);
      }}
    >
      <main className={band ? 'board board--with-band' : 'board'}>
        {band}
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
              onAnswer={onAnswer}
            />
          ))}
        </div>
        {tasks.length === 0 && <BoardMessage kind="empty" />}
      </main>
    </DragDropProvider>
  );
}
