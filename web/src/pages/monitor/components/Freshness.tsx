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
  failedCount,
  problemCount,
  onRefresh,
  compact = false,
}: {
  state: MonitorFreshnessState;
  lastFetchedAt: string | null;
  failedCount: number;
  problemCount: number;
  onRefresh(): void;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const message = t(`monitor.freshness.${state}`, { failed: failedCount, problems: problemCount });
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
          size="icon"
          className="monitor-refresh"
          aria-label={t('monitor.refresh')}
          onClick={onRefresh}
        >
          <RefreshCwIcon aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}
