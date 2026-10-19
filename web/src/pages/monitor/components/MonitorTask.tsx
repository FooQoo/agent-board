import { useTranslation } from 'react-i18next';
import { formatShort } from '../../../features/tasks/model/format';
import { TaskCardContent } from '../../../features/tasks/card/TaskCard';
import { StatusLabel } from '../../../features/tasks/status/StatusLabel';
import { AcceptanceProgress } from '../../../features/tasks/acceptance/AcceptanceProgress';
import { DecisionRequestForm } from '../../../features/tasks/answer/DecisionRequestForm';
import { noOperations } from '../../../shared/lib/operations/operations';
import type { AnswerWriter } from '../../../features/tasks/answer/model/answer';
import { EpicLabel } from '../../../features/epics/label/EpicLabel';
import type { MonitorTask as MonitorTaskModel, MonitorViewProps } from '../contracts';
import type { MonitorSection } from './MonitorSectionHeader';
import { completedAt } from '../model/sort';

const unavailableAnswerWriter: AnswerWriter = async () => {
  throw new Error('Monitor answer integration is not connected.');
};

export function MonitorTask({
  item,
  section,
  onOpenDetail,
  answerController,
}: {
  item: MonitorTaskModel;
  section: MonitorSection;
  onOpenDetail?: MonitorViewProps['onOpenDetail'];
  answerController?: MonitorViewProps['answerController'];
}) {
  const { t } = useTranslation();
  const task = item.task;
  const when =
    section === 'done'
      ? completedAt(item)
      : section === 'todo'
        ? task.createdAt
        : task.agentStatusChangedAt;
  // Keep the AI run state visible within active lanes; lane position and run state answer different questions.
  const showsState = section !== 'done' && task.assignee === 'ai';
  const pending = showsState && task.agentStatus === 'pending';
  const label = [
    `#${task.id}`,
    t(`monitor.status.${section}`),
    showsState ? t(`runState.${task.agentStatus}`) : '',
    task.title,
    pending ? task.pendingReason : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <article
      className={`monitor-card monitor-card--${section}`}
      aria-label={label}
      data-agent-status={showsState ? task.agentStatus : undefined}
    >
      <span className="monitor-card__top">
        <span className="monitor-card__id">#{task.id}</span>
        <span className="monitor-card__indicators">
          {showsState && <StatusLabel kind="agent" status={task.agentStatus} />}
          <AcceptanceProgress task={task} />
        </span>
      </span>
      <TaskCardContent
        task={task}
        showPendingReason={pending && task.pendingRequestId === null}
        titleClassName="monitor-card__title"
        reasonClassName="monitor-card__reason"
        titleActionDisabled={!onOpenDetail}
        onTitleClick={() => onOpenDetail?.(item, 'description')}
      >
        {task.epic && (
          <EpicLabel
            epic={task.epic}
            className="monitor-card__epic"
            disabled={!onOpenDetail}
            onClick={() => onOpenDetail?.(item, 'epic')}
          />
        )}
        {pending && task.pendingRequestId !== null && (
          <div className="monitor-card__request">
            <DecisionRequestForm
              projectId={item.projectId}
              task={task}
              operations={
                answerController?.operationsFor(item.projectId, task.id, task.pendingRequestId) ??
                noOperations
              }
              writeAnswer={answerController?.writeAnswer ?? unavailableAnswerWriter}
              stateStore={answerController?.stateStore}
              disabled={
                !answerController ||
                answerController.wasAnswered(item.projectId, task.id, task.pendingRequestId)
              }
              onRequestStale={(requestId) =>
                answerController?.markRequestStale(item.projectId, task.id, requestId)
              }
              onAnswered={(result) => {
                if (task.pendingRequestId)
                  answerController?.onAnswered(item, task.pendingRequestId, result);
              }}
            />
          </div>
        )}
      </TaskCardContent>
      <span className="monitor-card__meta">
        <span>{item.projectName}</span>
        <span className="monitor-card__time">
          {when
            ? formatShort(when)
            : section === 'done'
              ? t('monitor.completedUnknown')
              : formatShort(task.agentStatusChangedAt)}
        </span>
      </span>
    </article>
  );
}
