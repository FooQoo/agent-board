import { useTranslation } from 'react-i18next';
import { formatShort } from '../../lib/format';
import { CardContent } from '../../components/Card';
import { StatusLabel } from '../../components/StatusLabel';
import { AcceptanceProgress } from '../../components/acceptance/AcceptanceProgress';
import { DecisionRequestForm } from '../../components/detail/DecisionRequestForm';
import { noOperations } from '../../lib/projectSession';
import type { AnswerWriter } from '../../lib/answer';
import { EpicLabel } from '../../components/EpicLabel';
import type { MonitorCard as MonitorCardModel, MonitorViewProps } from '../contracts';
import type { MonitorSection } from './MonitorSectionHeader';
import { completedAt } from '../model/sort';

const unavailableAnswerWriter: AnswerWriter = async () => {
  throw new Error('Monitor answer integration is not connected.');
};

export function MonitorCard({
  item,
  section,
  onOpenDetail,
  answerController,
}: {
  item: MonitorCardModel;
  section: MonitorSection;
  onOpenDetail?: MonitorViewProps['onOpenDetail'];
  answerController?: MonitorViewProps['answerController'];
}) {
  const { t } = useTranslation();
  const card = item.card;
  const when =
    section === 'done'
      ? completedAt(item)
      : section === 'todo'
        ? card.createdAt
        : card.agentStatusChangedAt;
  // The run state shows in the sections for work the agent has in hand: awaiting a decision, running, and Doing.
  const showsState = section !== 'done' && card.agentStatus !== 'idle';
  const pending = showsState && card.agentStatus === 'pending';
  const label = [
    `#${card.id}`,
    t(`monitor.status.${section}`),
    showsState ? t(`runState.${card.agentStatus}`) : '',
    card.title,
    pending ? card.pendingReason : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <article
      className={`monitor-card monitor-card--${section}`}
      aria-label={label}
      data-agent-status={showsState ? card.agentStatus : undefined}
    >
      <span className="monitor-card__top">
        <span className="monitor-card__id">#{card.id}</span>
        {showsState && <StatusLabel kind="agent" status={card.agentStatus} />}
      </span>
      <CardContent
        card={card}
        showPendingReason={pending && card.pendingRequestId === null}
        titleClassName="monitor-card__title"
        reasonClassName="monitor-card__reason"
        titleActionDisabled={!onOpenDetail}
        onTitleClick={() => onOpenDetail?.(item, 'description')}
      >
        {card.epic && (
          <EpicLabel
            epic={card.epic}
            className="monitor-card__epic"
            disabled={!onOpenDetail}
            onClick={() => onOpenDetail?.(item, 'epic')}
          />
        )}
        {pending && card.pendingRequestId !== null && (
          <div className="monitor-card__request">
            <DecisionRequestForm
              projectId={item.projectId}
              card={card}
              operations={
                answerController?.operationsFor(item.projectId, card.id, card.pendingRequestId) ??
                noOperations
              }
              writeAnswer={answerController?.writeAnswer ?? unavailableAnswerWriter}
              stateStore={answerController?.stateStore}
              disabled={
                !answerController ||
                answerController.wasAnswered(item.projectId, card.id, card.pendingRequestId)
              }
              onRequestStale={(requestId) =>
                answerController?.markRequestStale(item.projectId, card.id, requestId)
              }
              onAnswered={(result) => {
                if (card.pendingRequestId)
                  answerController?.onAnswered(item, card.pendingRequestId, result);
              }}
            />
          </div>
        )}
      </CardContent>
      <span className="monitor-card__meta">
        <span>{item.projectName}</span>
        <span>
          {when
            ? formatShort(when)
            : section === 'done'
              ? t('monitor.completedUnknown')
              : formatShort(card.agentStatusChangedAt)}
        </span>
        <AcceptanceProgress card={card} />
      </span>
    </article>
  );
}
