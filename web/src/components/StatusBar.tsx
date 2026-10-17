import { taskCountLabel, formatTime } from '../lib/format';
import { useTranslation } from 'react-i18next';

export interface StatusBarProps {
  status: 'loading' | 'ready' | 'error';
  taskCount: number;
  countKind?: 'board' | 'archive';
  connected: boolean;
  lastSyncedAt: Date | null;
  /** A project state that replaces the count and the sync state with one line of text. */
  note?: 'boardLoading' | 'notSynced' | 'noProjects' | 'noSelection';
}

type Tone = 'ok' | 'idle' | 'warn';

function describeSync(
  { status, connected, lastSyncedAt }: StatusBarProps,
  t: ReturnType<typeof useTranslation>['t'],
): { text: string; tone: Tone } {
  if (status === 'loading') return { text: t('status.connecting'), tone: 'idle' };
  if (status === 'error') return { text: t('status.notConnected'), tone: 'warn' };
  const time = lastSyncedAt ? formatTime(lastSyncedAt) : '';
  return connected
    ? { text: t('status.synced', { time }), tone: 'ok' }
    : { text: t('status.disconnected', { time }), tone: 'warn' };
}

export function StatusBar(props: StatusBarProps) {
  const { t } = useTranslation();
  if (props.note) {
    return (
      <footer className="status-bar">
        <span className="status-bar__text" role="status">
          {t(`status.${props.note}`)}
        </span>
      </footer>
    );
  }
  const sync = describeSync(props, t);
  return (
    <footer className="status-bar">
      <span className="status-bar__count">
        {props.status === 'ready'
          ? props.countKind === 'archive'
            ? t('archive.count', { count: props.taskCount })
            : taskCountLabel(props.taskCount, t)
          : '–'}
      </span>
      <span className="status-bar__sync" role="status">
        <span className="status-bar__dot" data-tone={sync.tone} aria-hidden="true" />
        <span>{sync.text}</span>
      </span>
    </footer>
  );
}
