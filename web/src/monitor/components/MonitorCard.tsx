import { CheckIcon, LoaderIcon, PauseIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatShort } from '../../lib/format';
import type { MonitorCard as MonitorCardModel } from '../contracts';
import type { MonitorSection } from './MonitorSectionHeader';
import { completedAt } from '../model/sort';

export function MonitorCard({
  item,
  section,
  onSelect,
}: {
  item: MonitorCardModel;
  section: MonitorSection;
  onSelect(projectId: string, cardId: number): void;
}) {
  const { t } = useTranslation();
  const card = item.card;
  const when = section === 'done' ? completedAt(item) : card.agentStatusChangedAt;
  return (
    <button
      type="button"
      className={`monitor-card monitor-card--${section}`}
      onClick={() => onSelect(item.projectId, card.id)}
    >
      <span className="monitor-card__top">
        <span className="monitor-card__id">#{card.id}</span>
        <span className={`monitor-card__badge monitor-card__badge--${section}`}>
          {section === 'pending' ? (
            <PauseIcon aria-hidden="true" />
          ) : section === 'running' ? (
            <LoaderIcon aria-hidden="true" />
          ) : (
            <CheckIcon aria-hidden="true" />
          )}
          {t(`monitor.status.${section}`)}
        </span>
      </span>
      <span className="monitor-card__title">{card.title}</span>
      {section === 'pending' && card.pendingReason && (
        <span className="monitor-card__reason">{card.pendingReason}</span>
      )}
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
    </button>
  );
}
