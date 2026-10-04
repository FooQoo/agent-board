import type { RunState } from '../types';
import { StatusLabel } from './StatusLabel';

export function RunStateBadge({
  state,
  showIcon = false,
}: {
  state: RunState;
  showIcon?: boolean;
}) {
  return <StatusLabel kind="agent" status={state} showIcon={showIcon} />;
}
