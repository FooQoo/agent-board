import { useTranslation } from 'react-i18next';
import type { ColumnName, RunState } from '../types';
import { Pause, Spinner } from './icons';

export function StatusLabel({
  kind,
  status,
}: {
  kind: 'card' | 'agent';
  status: ColumnName | RunState;
}) {
  const { t } = useTranslation();
  const text = kind === 'card' ? t(`column.${status}`) : t(`runState.${status}`);
  const icon =
    kind === 'agent' && status === 'running' ? (
      <Spinner />
    ) : kind === 'agent' && status === 'pending' ? (
      <Pause />
    ) : null;
  return (
    <span className={`status-label status-label--${kind} status-label--${status}`}>
      {icon}
      {text}
    </span>
  );
}
