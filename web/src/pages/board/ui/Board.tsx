import { type ReactNode, useState } from 'react';
import { useBacklogSelection } from '../../../features/backlog/useSelection';
import { groupTasks } from '../../../features/tasks/model/board';
import type { TaskSummary, ColumnName } from '../../../shared/api/contracts';
import { BoardMessage, type BoardMessageKind } from './BoardMessage';
import { Lane } from './Lane';
import { DragDropProvider } from '@dnd-kit/react';
import { dropPlacement } from '../../../shared/lib/gesture/sortableDrag';
import type { ProjectId } from '../../../shared/api/contracts';

const COLUMNS: ColumnName[] = ['backlog', 'todo', 'doing', 'done'];

function isColumn(value: unknown): value is ColumnName {
  return COLUMNS.includes(value as ColumnName);
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
  /**
   * Cards of the Backlog were sent to Todo: by the button of the selection bar, or by dropping
   * them on the Todo lane. The screen confirms a warning and shows the result. Returns whether the
   * send was started without a confirmation, which ends the selection mode.
   */
  onSend?: (ids: number[]) => boolean;
  sendBusy?: boolean;
  /** The EPIC-ID label of a card was pressed. */
  onOpenEpic?: (epicId: string) => void;
  projectId?: ProjectId;
  onAnswer?: (taskId: number) => void;
  layoutRef?: (node: HTMLDivElement | null) => void;
  /** The band of unanswered questions above the lanes. */
  band?: ReactNode;
}

/**
 * The board of one project. The Backlog selection and the drag state belong to the project, so a
 * project change starts them over: a card of the same number in another project is not picked.
 */
export function Board(props: BoardProps) {
  return <ProjectBoard key={props.projectId ?? ''} {...props} />;
}

function ProjectBoard({
  message,
  tasks,
  selectedId,
  onSelect,
  onRetry,
  onMove,
  onReorder,
  onArchiveDone,
  onSend,
  sendBusy = false,
  onOpenEpic,
  projectId,
  onAnswer,
  layoutRef,
  band,
}: BoardProps) {
  const groups = groupTasks(tasks);
  const selection = useBacklogSelection(groups.backlog.map((task) => task.id));
  const [draggingId, setDraggingId] = useState<number | null>(null);
  // A send that needs no confirmation ends the selection mode; a warning keeps it until answered.
  const send = (ids: number[]) => {
    if (onSend?.(ids)) selection.leave();
  };
  if (message !== null) {
    return (
      <main className="board board--centered">
        <BoardMessage kind={message} onRetry={onRetry} />
      </main>
    );
  }

  // Reset the drag controller when cards change lanes so its retained source element cannot
  // remain beside the newly rendered card. Edits and same-lane reordering keep the controller.
  const laneMembership = tasks
    .map((task) => `${task.id}:${task.taskStatus}`)
    .sort()
    .join('|');
  return (
    <DragDropProvider
      key={laneMembership}
      onDragStart={(event) => {
        const id = event.operation.source?.data.taskId;
        setDraggingId(typeof id === 'number' ? id : null);
      }}
      onDragOver={(event) => {
        // Cards sort only inside their own lane. Another lane is a move, which waits for its reason, so
        // the card must not be shown there before it is confirmed.
        const { source, target } = event.operation;
        if (source && target && source.data.column !== target.data.column) event.preventDefault();
      }}
      onDragEnd={(event) => {
        setDraggingId(null);
        if (event.canceled) return;
        const taskId = event.operation.source?.data.taskId;
        const source = event.operation.source;
        const placement = dropPlacement(event.operation);
        const task = tasks.find((item) => item.id === taskId);
        const column = placement?.group;
        if (!task || !placement || !isColumn(column)) return;
        if (task.taskStatus === 'backlog' && column === 'todo' && onSend) {
          // The drag drops the focus from the card; the Backlog cards go to Todo as one send: the
          // picked cards when the grabbed one is among them, else only this card.
          if (source?.element instanceof HTMLElement) source.element.focus();
          send(
            selection.selecting && selection.picked.includes(task.id)
              ? selection.picked
              : [task.id],
          );
          return;
        }
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
              backlog={
                column === 'backlog' && onSend
                  ? { selection, busy: sendBusy, onSend: send, draggingId }
                  : undefined
              }
            />
          ))}
        </div>
        {tasks.length === 0 && <BoardMessage kind="empty" />}
      </main>
    </DragDropProvider>
  );
}
