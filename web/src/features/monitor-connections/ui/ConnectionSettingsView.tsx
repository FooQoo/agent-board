import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { LockIcon, XIcon } from 'lucide-react';
import { Button } from '@/shared/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/shared/ui/dialog';
import '../../../shared/styles/modal.css';
import './connection.css';
import { progressText } from './connectionProgress';
import type { ConnectionDraft, ConnectionQr, ConnectionStatus, TokenInfo } from './connectionTypes';
import { ConnectionReadySteps, ConnectionSetupSteps } from './ConnectionSteps';

export type { ConnectionDraft, ConnectionQr, ConnectionStatus, TokenInfo };

export interface ConnectionSettingsViewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Where the focus goes when the dialog closes (the settings button of the header). */
  restoreFocusRef?: { current: HTMLElement | null };
  status: ConnectionStatus;
  /** The values the form starts from; the form keeps its own copy while it is edited. */
  draft: ConnectionDraft;
  /** The public phone URL, known once the connection is ready. */
  url?: string | null;
  /** The 4-digit passcode the phone enters, known once the connection is ready. */
  passcode?: string | null;
  qr?: ConnectionQr | null;
  tokenInfo?: TokenInfo;
  /** Delete the token saved in this PC's secure storage. */
  onDeleteToken?: () => void;
  /** A message about the last start or save, shown with the form. */
  error?: string | null;
  /** A save or stop request is in flight. */
  saving?: boolean;
  /** Save the draft and start. */
  onConnect: (draft: ConnectionDraft) => void;
  onStop: () => void;
  /** Go back from the connected view to the setup, to enter the token again. */
  onResetToken: () => void;
}

/**
 * The PC dialog that sets up, shows and stops the ngrok phone connection. Only a ready connection
 * shows the connected view; every other status shows the setup, with the progress text in the
 * place of the two steps while a start or a stop is under way.
 */
export function ConnectionSettingsView({
  open,
  onOpenChange,
  restoreFocusRef,
  status,
  draft,
  url = null,
  passcode = null,
  qr = null,
  tokenInfo = { source: null, keychainAvailable: true, saved: false },
  onDeleteToken,
  error = null,
  saving = false,
  onConnect,
  onStop,
  onResetToken,
}: ConnectionSettingsViewProps) {
  const { t } = useTranslation();
  const [values, setValues] = useState<ConnectionDraft>(draft);
  const [copied, setCopied] = useState(false);

  // Reset only when the values differ, so an equal draft from a re-render keeps what was typed.
  useEffect(() => setValues({ token: draft.token, save: draft.save }), [draft.token, draft.save]);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const connected = status === 'ready';
  // Stopped with a token saved: the dialog offers to connect again with it, without typing it.
  const stopped = status === 'disabled' && tokenInfo.saved;
  const busy =
    saving || status === 'starting' || status === 'reconnecting' || status === 'stopping';
  const progress = progressText(status, t);
  const message = status === 'failed' ? (error ?? t('monitorConnection.failedTitle')) : error;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    onConnect(values);
    // The token has gone to the start request; the form does not keep showing it.
    setValues((current) => ({ ...current, token: '' }));
  };

  const copyUrl = () => {
    if (!url) return;
    void navigator.clipboard?.writeText(url).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="modal connection-dialog"
        showCloseButton={false}
        aria-describedby={undefined}
        onCloseAutoFocus={(event) => {
          const target = restoreFocusRef?.current;
          if (!target?.isConnected) return;
          event.preventDefault();
          target.focus();
        }}
      >
        <div className="modal__header">
          <DialogTitle className="modal__title">{t('monitorConnection.title')}</DialogTitle>
          <Button
            type="button"
            variant="outline"
            size="m"
            iconOnly
            className="connection-dialog__close"
            aria-label={t('dialog.close')}
            onClick={() => onOpenChange(false)}
          >
            <XIcon aria-hidden="true" />
          </Button>
        </div>

        <p
          className={`connection-dialog__state${connected ? ' connection-dialog__state--on' : ''}`}
          role={connected ? 'status' : undefined}
        >
          <span className="connection-dialog__dot" aria-hidden="true" />
          {connected
            ? t('monitorConnection.statusOn')
            : stopped
              ? t('monitorConnection.statusStopped')
              : t('monitorConnection.statusOff')}
        </p>
        {!stopped && <p className="connection-dialog__intro">{t('monitorConnection.intro')}</p>}

        {connected ? (
          <div className="connection-dialog__main">
            <div className="connection-dialog__body">
              <ConnectionReadySteps qr={qr} passcode={passcode} copied={copied} onCopy={copyUrl} />
            </div>
            <div className="connection-dialog__footer">
              <p className="connection-dialog__notice">
                <LockIcon aria-hidden="true" />
                {t('monitorConnection.protectNotice')}
              </p>
              <div className="connection-dialog__actions">
                <Button type="button" variant="outline" disabled={busy} onClick={onResetToken}>
                  {t('monitorConnection.resetToken')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="connection-dialog__stop"
                  disabled={busy}
                  onClick={onStop}
                >
                  {saving ? t('monitorConnection.stopping') : t('monitorConnection.stop')}
                </Button>
              </div>
            </div>
          </div>
        ) : stopped ? (
          <div className="connection-dialog__main">
            <div className="connection-dialog__body">
              <div className="connection-dialog__stopped">
                <h3>{t('monitorConnection.stoppedTitle')}</h3>
                <p>{t('monitorConnection.stoppedToken')}</p>
                <p>{t('monitorConnection.stoppedNext')}</p>
              </div>
            </div>
            <div className="connection-dialog__footer">
              {message && (
                <p className="connection-dialog__error" role="alert">
                  {message}
                </p>
              )}
              <div className="connection-dialog__actions">
                <Button type="button" variant="outline" disabled={busy} onClick={onResetToken}>
                  {t('monitorConnection.changeSettings')}
                </Button>
                <Button
                  type="button"
                  className="connection-dialog__reconnect"
                  disabled={busy}
                  onClick={() => onConnect({ token: '', save: false })}
                >
                  {t('monitorConnection.reconnect')}
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <form className="connection-dialog__main" onSubmit={submit} noValidate>
            <div className="connection-dialog__body">
              {progress ? (
                <div className="connection-dialog__progress" role="status">
                  <h3>{progress.title}</h3>
                  <p>{progress.body}</p>
                </div>
              ) : (
                <ConnectionSetupSteps
                  values={values}
                  onChange={setValues}
                  tokenInfo={tokenInfo}
                  busy={busy}
                  onDeleteToken={onDeleteToken}
                />
              )}
            </div>
            <div className="connection-dialog__footer connection-dialog__footer--end">
              {message && (
                <p className="connection-dialog__error" role="alert">
                  {message}
                </p>
              )}
              <Button type="submit" className="connection-dialog__submit" disabled={busy}>
                {status === 'stopping'
                  ? t('monitorConnection.stopping')
                  : busy
                    ? t('monitorConnection.connecting')
                    : t('monitorConnection.save')}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
