import { useTranslation } from 'react-i18next';
import { formatShort } from '../../lib/format';
import { CardContent } from '../../components/Card';
import { StatusLabel } from '../../components/StatusLabel';
import { AcceptanceProgress } from '../../components/acceptance/AcceptanceProgress';
import type { MonitorCard as MonitorCardModel } from '../contracts';
import type { MonitorSection } from './MonitorSectionHeader';
import { completedAt } from '../model/sort';

export function MonitorCard({
  item,
  section,
}: {
  item: MonitorCardModel;
  section: MonitorSection;
}) {
  const { t } = useTranslation();
  const card = item.card;
  const when =
    section === 'done'
      ? completedAt(item)
      : section === 'todo'
        ? card.createdAt
        : card.agentStatusChangedAt;
  const showsState = section === 'doing';
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
        showPendingReason={pending}
        titleClassName="monitor-card__title"
        reasonClassName="monitor-card__reason"
      />
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
