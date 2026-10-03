import { cardCountLabel, formatTime } from '../lib/format';

export interface StatusBarProps {
  status: 'loading' | 'ready' | 'error';
  cardCount: number;
  connected: boolean;
  lastSyncedAt: Date | null;
}

type Tone = 'ok' | 'idle' | 'warn';

function describeSync({ status, connected, lastSyncedAt }: StatusBarProps): { text: string; tone: Tone } {
  if (status === 'loading') return { text: 'Connecting…', tone: 'idle' };
  if (status === 'error') return { text: 'Not connected', tone: 'warn' };
  const time = lastSyncedAt ? formatTime(lastSyncedAt) : '';
  return connected
    ? { text: `Synced ${time}`, tone: 'ok' }
    : { text: `Disconnected · Last synced ${time}`, tone: 'warn' };
}

export function StatusBar(props: StatusBarProps) {
  const sync = describeSync(props);
  return (
    <footer className="status-bar">
      <span className="status-bar__count">{props.status === 'ready' ? cardCountLabel(props.cardCount) : '–'}</span>
      <span className="status-bar__sync" role="status">
        <span className="status-bar__dot" data-tone={sync.tone} aria-hidden="true" />
        <span>{sync.text}</span>
      </span>
    </footer>
  );
}
