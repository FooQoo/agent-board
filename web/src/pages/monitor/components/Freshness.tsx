import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleOffIcon,
  LoaderIcon,
  RefreshCwIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatShort } from '../../../features/tasks/model/format';
import { Button } from '@/shared/ui/button';
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
  onRefresh,
  refreshing = false,
  compact = false,
}: {
  state: MonitorFreshnessState;
  lastFetchedAt: string | null;
  problemCount: number;
  onRefresh(): void;
  /** A refresh the person asked for is running; the button waits for it. */
  refreshing?: boolean;
  compact?: boolean;
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
      {lastFetchedAt && (
        <span className="monitor-freshness__time">
          {t('monitor.lastFetched', { time: formatShort(lastFetchedAt) })}
        </span>
      )}
      {!compact && (
        <Button
          type="button"
          variant="outline"
          size="l"
          iconOnly
          className="monitor-refresh"
          aria-label={t('monitor.refresh')}
          disabled={refreshing}
          onClick={onRefresh}
        >
          <RefreshCwIcon aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}
