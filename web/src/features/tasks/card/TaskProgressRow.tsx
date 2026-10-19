import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { Task } from '../../../shared/api/contracts';
import { AcceptanceProgress } from '../acceptance/AcceptanceProgress';
import { AssigneeLabel } from '../assignee/AssigneeLabel';
import { StatusLabel } from '../status/StatusLabel';
import { formatShort } from '../model/format';
import { TaskCardContent } from './TaskCard';

/**
 * What a task shows in a row of an epic's progress table: the same parts as a board card, with the
 * title opening the task. The table supplies the drag `grip`.
 */
export function TaskProgressRow({
  task,
  grip,
  disabled,
  onOpen,
}: {
  task: Task;
  grip: ReactNode;
  disabled: boolean;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <div className="card__top">
        {grip}
        <span className="card__id">#{task.id}</span>
        <AssigneeLabel assignee={task.assignee} />
        {task.isDraft && <span className="card__draft">{t('draft.label')}</span>}
        <span className="card__spacer" />
        <StatusLabel
          kind={task.taskStatus === 'done' ? 'card' : 'agent'}
          status={task.taskStatus === 'done' ? 'done' : task.agentStatus}
        />
      </div>
      <TaskCardContent
        task={task}
        titleClassName="card__title epic-progress__name"
        titleActionDisabled={disabled}
        onTitleClick={onOpen}
        showPendingReason={false}
      />
      <div className="card__foot epic-progress__foot">
        <span className="card__updated">
          {t('card.updated', { date: formatShort(task.updatedAt) })}
        </span>
        <AcceptanceProgress task={task} />
      </div>
    </>
  );
}
