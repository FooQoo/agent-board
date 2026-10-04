import type { RunState } from '../types';
import { StatusLabel } from './StatusLabel';

export function RunStateBadge({
  state,
  animated = false,
}: {
  state: RunState;
  animated?: boolean;
}) {
  return <StatusLabel kind="agent" status={state} animated={animated} />;
}
