import { useTranslation } from 'react-i18next';
import { CheckIcon, LoaderIcon, PauseIcon } from 'lucide-react';
import { Badge } from '@/shared/ui/badge';
import type { ColumnName, RunState } from '../../../shared/api/contracts';

export function TaskStatusBadge({ status }: { status: ColumnName }) {
  const { t } = useTranslation();
  return (
    <Badge variant={status === 'doing' ? 'default' : status === 'done' ? 'secondary' : 'outline'}>
      {status === 'done' && <CheckIcon aria-hidden="true" className="text-[color:var(--r-done)]" />}
      {t(`column.${status}`)}
    </Badge>
  );
}

export function RunStatusBadge({ status }: { status: RunState }) {
  const { t } = useTranslation();
  return (
    <Badge
      variant={status === 'pending' ? 'pending' : status === 'running' ? 'secondary' : 'muted'}
    >
      {status === 'running' && (
        <LoaderIcon aria-hidden="true" className="text-[color:var(--r-text2)]" />
      )}
      {status === 'pending' && <PauseIcon aria-hidden="true" />}
      {t(`runState.${status}`)}
    </Badge>
  );
}
