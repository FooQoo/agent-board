import { useTranslation } from 'react-i18next';
import { Badge } from '@/shared/ui/badge';
import type { ResidentState } from '../state';

const KEY = {
  working: 'resident.stateWorking',
  waiting: 'resident.stateWaiting',
  restarting: 'resident.stateRestarting',
  stopped: 'resident.stateStopped',
  failed: 'resident.stateFailed',
} as const;

const SHORT_KEY = {
  working: 'resident.shortWorking',
  waiting: 'resident.shortWaiting',
  restarting: 'resident.shortRestarting',
  stopped: 'resident.stateStopped',
  failed: 'resident.shortFailed',
} as const;

const VARIANT = {
  working: 'outline',
  waiting: 'outline',
  restarting: 'pending',
  stopped: 'muted',
  failed: 'destructive',
} as const;

/** The word for a state, in the long form of the badge or the short form of a summary line. */
export function useStateLabel() {
  const { t } = useTranslation();
  return (state: ResidentState, short = false) => t(short ? SHORT_KEY[state] : KEY[state]);
}

/** The state badge: the dot colour carries the state next to its word. */
export function StateBadge({ state }: { state: ResidentState }) {
  const label = useStateLabel();
  return (
    <Badge variant={VARIANT[state]} className="resident-state" data-state={state}>
      <span className="resident-dot" aria-hidden="true" />
      {label(state)}
    </Badge>
  );
}
