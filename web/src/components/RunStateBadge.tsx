import type { RunState } from '../types';
import { Pause, Spinner } from './icons';

export function RunStateBadge({ state }: { state: RunState }) {
  switch (state) {
    case 'running':
      return (
        <span className="run-state run-state--running">
          <Spinner />
          Running
        </span>
      );
    case 'pending':
      return (
        <span className="run-state run-state--pending">
          <Pause />
          Pending
        </span>
      );
    default:
      return <span className="run-state run-state--idle">Idle</span>;
  }
}
