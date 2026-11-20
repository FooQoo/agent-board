import type { ReactNode } from 'react';
import { CircleAlertIcon, CircleCheckIcon, CircleOffIcon, LoaderIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatShort } from '../../../features/tasks/model/format';
import type { MonitorFreshnessState } from '../contracts';

const icon = {
  loading: <LoaderIcon />,
  syncing: <LoaderIcon />,
  fresh: <CircleCheckIcon />,
  stale: <CircleOffIcon />,
  partial: <CircleAlertIcon />,
  error: <CircleOffIcon />,
};
export function Freshness({
  state,
  lastFetchedAt,
  problemCount,
  compact = false,
  slot,
}: {
  state: MonitorFreshnessState;
  lastFetchedAt: string | null;
  problemCount: number;
  compact?: boolean;
  /** A display-only indicator after the message, such as the resident session's state. */
  slot?: ReactNode;
}) {
  const { t } = useTranslation();
  const message =
    state === 'partial'
      ? t('dataLayerMonitor.partial', { problems: problemCount })
      : t(`monitor.freshness.${state}`);
  return (
    <div
      className={`monitor-freshness${compact ? ' monitor-freshness--compact' : ''}`}
      data-state={state}
      role="status"
    >
      {icon[state]}
      <span className="monitor-freshness__message">{message}</span>
      {slot}
      {lastFetchedAt && (
        <span className="monitor-freshness__time">
          {t('monitor.lastFetched', { time: formatShort(lastFetchedAt) })}
        </span>
      )}
    </div>
  );
}
