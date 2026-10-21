import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyRoundIcon, RefreshCwIcon } from 'lucide-react';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { Header } from '../../../shared/ui/app-header/Header';
import { monitorLogo } from '../logo';
import './connection-state.css';

/**
 * Why the phone has no monitor data: the four-digit passcode is needed (never entered, ended,
 * or the monitor was restarted), or the connection to the PC dropped and is being restored.
 */
export type MonitorConnectionStatus = 'needs_passcode' | 'reconnecting';

/** The number of digits in the passcode the PC shows. */
export const PASSCODE_LENGTH = 4;

export interface ConnectionStateViewProps {
  status: MonitorConnectionStatus;
  /** A message about the last attempt, or about why the passcode is needed again. */
  error?: string | null;
  /** The monitor stopped taking passcodes; only starting the connection again on the PC helps. */
  locked?: boolean;
  /** A passcode is being checked. */
  checking?: boolean;
  /** Send the passcode that was typed. Only the passcode screen has the form. */
  onSubmit?: (code: string) => void;
}

/** The phone screen shown instead of the monitor while it cannot read data. */
export function ConnectionStateView({
  status,
  error = null,
  locked = false,
  checking = false,
  onSubmit,
}: ConnectionStateViewProps) {
  const { t } = useTranslation();
  const needsPasscode = status === 'needs_passcode';
  const Icon = needsPasscode ? KeyRoundIcon : RefreshCwIcon;
  const [code, setCode] = useState('');
  const complete = code.length === PASSCODE_LENGTH;
  const disabled = checking || locked;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (complete && !disabled) onSubmit?.(code);
  };

  return (
    <main className="monitor-shell">
      <Header logoSrc={monitorLogo} />
      <section className="connection-state" aria-live="polite">
        <Icon className="connection-state__icon" aria-hidden="true" strokeWidth={1.5} />
        <h2 className="connection-state__title">
          {needsPasscode
            ? t('monitorConnection.phone.passcodeTitle')
            : t('monitorConnection.phone.waitingTitle')}
        </h2>
        <p className="connection-state__body">
          {needsPasscode
            ? t('monitorConnection.phone.passcodeBody')
            : t('monitorConnection.phone.waitingBody')}
        </p>
        {error && (
          <p className="connection-state__error" role="alert">
            {error}
          </p>
        )}
        {needsPasscode && (
          <form className="connection-state__form" onSubmit={submit} noValidate>
            <Label htmlFor="monitor-passcode" className="connection-state__label">
              {t('monitorConnection.phone.passcodeLabel')}
            </Label>
            <Input
              id="monitor-passcode"
              className="connection-state__code"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="go"
              value={code}
              disabled={disabled}
              onChange={(event) =>
                setCode(event.target.value.replace(/\D/g, '').slice(0, PASSCODE_LENGTH))
              }
            />
            <Button
              type="submit"
              className="connection-state__action"
              disabled={disabled || !complete}
            >
              {checking
                ? t('monitorConnection.phone.checking')
                : t('monitorConnection.phone.passcodeAction')}
            </Button>
          </form>
        )}
      </section>
    </main>
  );
}
