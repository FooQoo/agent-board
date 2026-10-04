import type { RunState } from '../types';
import { StatusLabel } from './StatusLabel';

export function RunStateBadge({ state }: { state: RunState }) {
  return <StatusLabel kind="agent" status={state} />;
}
