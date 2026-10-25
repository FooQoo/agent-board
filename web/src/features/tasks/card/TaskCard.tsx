import { useTranslation } from 'react-i18next';
import type { ReactNode, RefCallback } from 'react';
import { formatShort, stateLabel } from '../model/format';
import { AcceptanceProgress } from '../acceptance/AcceptanceProgress';
import type { EpicRef, TaskSummary as TaskModel } from '../../../shared/api/contracts';
import { GripVerticalIcon } from 'lucide-react';
import { AssigneeLabel } from '../assignee/AssigneeLabel';
import { StatusLabel } from '../status/StatusLabel';
import { useSortable } from '@dnd-kit/react/sortable';
import { DecisionRequestForm } from '../answer/DecisionRequestForm';
import { noOperations } from '../../../shared/lib/operations/operations';
import type { TaskAnswerController } from '../answer/model/useTaskAnswers';
import type { ProjectId } from '../../../shared/api/contracts';
import './card-answer.css';

export interface TaskCardProps {
  task: TaskModel;
  selected: boolean;
  onSelect: (id: number) => void;
  /** The card's place in its lane, in the order the board shows. */
  index?: number;
  /** Draws the card's EPIC-ID label. The page that composes the board supplies it; without it no label shows. */
  renderEpic?: (epic: EpicRef) => ReactNode;
  projectId?: ProjectId;
  answers?: TaskAnswerController;
  syncedAt?: Date | null;
  onAnswerChanged?: () => void;
}

export interface TaskCardViewProps {
  task: TaskModel;
  selected: boolean;
  isDragging?: boolean;
  onSelect: (id: number) => void;
  cardRef?: RefCallback<HTMLDivElement>;
  renderEpic?: (epic: EpicRef) => ReactNode;
  showPendingReason?: boolean;
  children?: ReactNode;
}

export function TaskCardContent({
  task,
  titleClassName = 'card__title',
  reasonClassName = 'card__reason',
  showPendingReason = task.agentStatus === 'pending',
  titleActionDisabled,
  onTitleClick,
  children,
}: {
  task: TaskModel;
  titleClassName?: string;
  reasonClassName?: string;
  showPendingReason?: boolean;
  /** Optional title action for monitor detail navigation. */
  titleActionDisabled?: boolean;
  onTitleClick?: () => void;
  children?: ReactNode;
}) {
  return (
    <>
      {titleActionDisabled !== undefined ? (
        <button
          type="button"
          className={titleClassName}
          disabled={titleActionDisabled}
          onClick={onTitleClick}
        >
          {task.title}
        </button>
      ) : (
        <span className={titleClassName}>{task.title}</span>
      )}
      {children}
      {showPendingReason && task.pendingReason && (
        <span className={reasonClassName}>{task.pendingReason}</span>
      )}
    </>
  );
}

/** Visual card shell, independent of drag-and-drop and inline answer controllers. */
export function TaskCardView({
  task,
  selected,
  isDragging = false,
  onSelect,
  cardRef,
  renderEpic,
  showPendingReason = task.agentStatus === 'pending',
  children,
}: TaskCardViewProps) {
  const { t } = useTranslation();
  const showsState = stateLabel(task, t) !== null;
  const pending = showsState && task.agentStatus === 'pending';
  const className = [
    'card',
    pending ? 'card--pending' : '',
    selected ? 'card--selected' : '',
    isDragging ? 'card--dragging' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="card__item" role="group" tabIndex={-1}>
      <div
        ref={cardRef}
        className={className}
        role="button"
        tabIndex={0}
        aria-current={selected ? 'true' : 'false'}
        onClick={() => onSelect(task.id)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && event.target === event.currentTarget) onSelect(task.id);
        }}
      >
        <span className="card__top">
          <GripVerticalIcon aria-hidden="true" focusable="false" className="grip" />
          <span className="card__id">#{task.id}</span>
          <AssigneeLabel assignee={task.assignee} />
          {task.isDraft && <span className="card__draft">{t('draft.label')}</span>}
          <span className="card__spacer" />
          {showsState && <StatusLabel kind="agent" status={task.agentStatus} />}
        </span>
        <TaskCardContent task={task} showPendingReason={pending && showPendingReason}>
          {task.epic && renderEpic?.(task.epic)}
        </TaskCardContent>
        <span className="card__foot">
          <span className="card__updated">
            {t('card.updated', { date: formatShort(task.updatedAt) })}
          </span>
          <AcceptanceProgress task={task} />
        </span>
      </div>
      {children}
    </div>
  );
}

/**
 * A board card. It is a direct child of its lane's card container, so the sorting moves it among its
 * siblings and the lane keeps its gaps. The card is the draggable, selectable area (the drag library gives it the button role); the
 * EPIC-ID label is a button of its own, so a press on it opens the epic and does not select the card.
 */
export function TaskCard({
  task,
  selected,
  index = 0,
  onSelect,
  renderEpic,
  projectId,
  answers,
  syncedAt = null,
  onAnswerChanged,
}: TaskCardProps) {
  const { t } = useTranslation();
  const showsState = stateLabel(task, t) !== null;
  const pending = showsState && task.agentStatus === 'pending';
  const showInlineAnswer = Boolean(
    projectId && answers && pending && task.pendingRequestId !== null,
  );
  const { ref, isDragging } = useSortable({
    id: `card-${task.id}`,
    index,
    group: task.taskStatus,
    data: { taskId: task.id, column: task.taskStatus },
  });
  return (
    <TaskCardView
      task={task}
      selected={selected}
      isDragging={isDragging}
      onSelect={onSelect}
      cardRef={ref}
      renderEpic={renderEpic}
      showPendingReason={!showInlineAnswer}
    >
      {projectId && answers && showInlineAnswer && (
        <div className="card__answer" data-task-id={task.id}>
          <DecisionRequestForm
            projectId={projectId}
            task={task}
            operations={noOperations}
            stateStore={answers.stateStore}
            writeAnswer={answers.writeAnswer}
            disabled={answers.wasAnswered(projectId, task.id, task.pendingRequestId)}
            onChanged={onAnswerChanged}
            onAnswered={(result) =>
              task.pendingRequestId &&
              answers.onAnswered(projectId, task.id, task.pendingRequestId, result, syncedAt)
            }
          />
        </div>
      )}
    </TaskCardView>
  );
}
