import { ArrowDownIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SpinnerIcon } from '@/shared/ui/spinner/Spinner';
import type { PullState } from '../hooks/usePullToRefresh';

/**
 * What pulling down at the top of a lane shows above its cards: an arrow while the finger pulls,
 * turned over once a release would refresh, and a spinner while the board refreshes. It takes
 * `offset` px above the cards, so the cards follow the finger down.
 */
export function PullIndicator({ state, offset }: { state: PullState; offset: number }) {
  const { t } = useTranslation();
  if (state === 'idle') return null;
  const label =
    state === 'refreshing'
      ? t('monitor.freshness.syncing')
      : state === 'ready'
        ? t('monitor.pull.release')
        : t('monitor.pull.hint');
  return (
    <div
      className="monitor-pull"
      data-state={state}
      role="status"
      style={{ height: `${offset}px` }}
    >
      {state === 'refreshing' ? (
        <SpinnerIcon size="md" className="monitor-pull__spinner" />
      ) : (
        <ArrowDownIcon className="monitor-pull__arrow" aria-hidden="true" />
      )}
      <span className={state === 'refreshing' ? 'visually-hidden' : undefined}>{label}</span>
    </div>
  );
}
