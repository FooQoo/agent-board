import { useTranslation } from 'react-i18next';
import { formatShort } from '../../lib/format';
import { CardContent } from '../../components/Card';
import { StatusLabel } from '../../components/StatusLabel';
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
  const when = section === 'done' ? completedAt(item) : card.agentStatusChangedAt;
  return (
    <article
      className={`monitor-card monitor-card--${section}`}
      aria-label={`#${card.id} ${t(`monitor.status.${section}`)} ${card.title} ${card.pendingReason ?? ''}`}
    >
      <span className="monitor-card__top">
        <span className="monitor-card__id">#{card.id}</span>
        <StatusLabel
          kind={section === 'done' ? 'card' : 'agent'}
          status={section === 'done' ? card.cardStatus : card.agentStatus}
          monitor
        />
      </span>
      <CardContent
        card={card}
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
      </span>
    </article>
  );
}
