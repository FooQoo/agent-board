import { useTranslation } from 'react-i18next';
import { LogInIcon, RefreshCwIcon } from 'lucide-react';
import { Button } from '@/shared/ui/button';
import { Header } from '../../../shared/ui/app-header/Header';
import './connection-state.css';

/**
 * Why the phone has no monitor data: Google sign-in is needed again, or the connection to the PC
 * dropped and is being restored.
 */
export type MonitorConnectionStatus = 'needs_google' | 'reconnecting';

export interface ConnectionStateViewProps {
  status: MonitorConnectionStatus;
  /** A message about the last attempt to sign in again. */
  error?: string | null;
  /** The page is already moving to the Google sign-in. */
  saving?: boolean;
  /** Go to Google to sign in again. */
  onConnect: () => void;
}

/** The phone screen shown instead of the monitor while it cannot read data. */
export function ConnectionStateView({
  status,
  error = null,
  saving = false,
  onConnect,
}: ConnectionStateViewProps) {
  const { t } = useTranslation();
  const needsGoogle = status === 'needs_google';
  const Icon = needsGoogle ? LogInIcon : RefreshCwIcon;

  return (
    <main className="monitor-shell">
      <Header />
      <section className="connection-state" aria-live="polite">
        <Icon className="connection-state__icon" aria-hidden="true" strokeWidth={1.5} />
        <h2 className="connection-state__title">
          {needsGoogle
            ? t('monitorConnection.phone.reauthTitle')
            : t('monitorConnection.phone.waitingTitle')}
        </h2>
        <p className="connection-state__body">
          {needsGoogle
            ? t('monitorConnection.phone.reauthBody')
            : t('monitorConnection.phone.waitingBody')}
        </p>
        {error && (
          <p className="connection-state__error" role="alert">
            {error}
          </p>
        )}
        {needsGoogle && (
          <Button
            type="button"
            className="connection-state__action"
            disabled={saving}
            onClick={onConnect}
          >
            {saving
              ? t('monitorConnection.phone.opening')
              : t('monitorConnection.phone.reauthAction')}
          </Button>
        )}
      </section>
    </main>
  );
}
