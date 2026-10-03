import { useTranslation } from 'react-i18next';
import type { RunState } from '../types';
import { Pause, Spinner } from './icons';

export function RunStateBadge({ state }: { state: RunState }) {
  const { t } = useTranslation();
  switch (state) {
    case 'running':
      return (
        <span className="run-state run-state--running">
          <Spinner />
          {t('runState.running')}
        </span>
      );
    case 'pending':
      return (
        <span className="run-state run-state--pending">
          <Pause />
          {t('runState.pending')}
        </span>
      );
    default:
      return <span className="run-state run-state--idle">{t('runState.idle')}</span>;
  }
}
