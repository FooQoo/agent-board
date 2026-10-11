import { useTranslation } from 'react-i18next';
import { CheckIcon, LoaderIcon, PauseIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { ColumnName, RunState } from '../types';

type Variant = 'default' | 'secondary' | 'outline' | 'muted' | 'pending';

/** Card status and agent run state share one badge; the icons are decoration next to the text. */
export function StatusLabel({
  kind,
  status,
  monitor = false,
}: {
  kind: 'card' | 'agent';
  status: ColumnName | RunState;
  monitor?: boolean;
}) {
  const { t } = useTranslation();
  const monitorState = kind === 'agent' && (status === 'pending' || status === 'running');
  const monitorLane = kind === 'card' && status === 'done';
  const text =
    monitor && monitorState
      ? t(`monitor.status.${status}`)
      : monitor && monitorLane
        ? t('monitor.status.done')
        : kind === 'card'
          ? t(`column.${status}`)
          : t(`runState.${status}`);
  let variant: Variant;
  let icon = null;
  if (kind === 'card') {
    variant = status === 'doing' ? 'default' : status === 'done' ? 'secondary' : 'outline';
    if (status === 'done') icon = <CheckIcon aria-hidden="true" className="text-[var(--r-done)]" />;
  } else if (status === 'running') {
    variant = 'secondary';
    icon = <LoaderIcon aria-hidden="true" className="spinner text-[var(--r-text2)]" />;
  } else if (status === 'pending') {
    variant = 'pending';
    icon = <PauseIcon aria-hidden="true" />;
  } else {
    variant = 'muted';
  }
  return (
    <Badge
      variant={variant}
      className={`status-label status-label--${kind} status-label--${status}`}
    >
      {icon}
      {text}
    </Badge>
  );
}
