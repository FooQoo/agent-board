import { useEffect, useId, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { XIcon } from 'lucide-react';
import { Button } from '@/shared/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/shared/ui/dialog';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import '../../../shared/styles/modal.css';
import './connection.css';
import { progressText, type ConnectionStatus } from './connectionProgress';

export type { ConnectionStatus };

/** What the person types: the token is held in memory only and never shown again. */
export interface ConnectionDraft {
  token: string;
  email: string;
  domain: string;
}

/** The QR code of the phone URL, as an image the caller already rendered. */
export interface ConnectionQr {
  /** An image URL (a data URL is fine). */
  src: string;
  /** The picture is a layout sample and cannot be scanned. */
  sample?: boolean;
}

export interface ConnectionSettingsViewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  status: ConnectionStatus;
  /** The values the form starts from; the form keeps its own copy while it is edited. */
  draft: ConnectionDraft;
  /** The public phone URL, known once the connection is ready. */
  url?: string | null;
  qr?: ConnectionQr | null;
  /** A message about the last start or save, shown with the form. */
  error?: string | null;
  /** A save or stop request is in flight. */
  saving?: boolean;
  /** Save the draft and start. */
  onConnect: (draft: ConnectionDraft) => void;
  onStop: () => void;
  /** Go back from the connected view to the form. */
  onEdit: () => void;
}

const FORM_STATUSES: readonly ConnectionStatus[] = [
  'disabled',
  'needs_config',
  'starting',
  'reconnecting',
  'failed',
  'stopping',
];

/** The PC dialog that sets up, shows and stops the ngrok phone connection. */
export function ConnectionSettingsView({
  open,
  onOpenChange,
  status,
  draft,
  url = null,
  qr = null,
  error = null,
  saving = false,
  onConnect,
  onStop,
  onEdit,
}: ConnectionSettingsViewProps) {
  const { t } = useTranslation();
  const [values, setValues] = useState<ConnectionDraft>(draft);
  const [copied, setCopied] = useState(false);
  const ids = { token: useId(), email: useId(), domain: useId(), url: useId() };

  // Reset only when the values differ, so an equal draft from a re-render keeps what was typed.
  useEffect(
    () => setValues({ token: draft.token, email: draft.email, domain: draft.domain }),
    [draft.token, draft.email, draft.domain],
  );
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const connected = status === 'ready';
  const busy =
    saving || status === 'starting' || status === 'reconnecting' || status === 'stopping';
  const progress = progressText(status, t);
  const set = (field: keyof ConnectionDraft) => (event: { target: { value: string } }) =>
    setValues((current) => ({ ...current, [field]: event.target.value }));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!busy) onConnect(values);
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
      >
        <div className="modal__header">
          <DialogTitle className="modal__title">{t('monitorConnection.title')}</DialogTitle>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="connection-dialog__close"
            aria-label={t('dialog.close')}
            onClick={() => onOpenChange(false)}
          >
            <XIcon aria-hidden="true" />
          </Button>
        </div>

        <p className="connection-dialog__intro">{t('monitorConnection.intro')}</p>

        {connected ? (
          <div className="connection-dialog__connected">
            <p className="connection-dialog__status" role="status">
              {t('monitorConnection.connected')}
            </p>
            <div className="connection-dialog__field">
              <Label htmlFor={ids.url}>{t('monitorConnection.url')}</Label>
              <Input id={ids.url} value={url ?? ''} readOnly />
            </div>
            {values.email && (
              <p className="connection-dialog__meta">
                {t('monitorConnection.allowedEmail', { email: values.email })}
              </p>
            )}
            <div className="connection-dialog__qr">
              <figure className="connection-dialog__qr-figure">
                {qr && <img src={qr.src} alt={t('monitorConnection.qrAlt')} />}
                {qr?.sample && (
                  <figcaption className="connection-dialog__qr-note">
                    {t('monitorConnection.qrSample')}
                  </figcaption>
                )}
              </figure>
              <div className="connection-dialog__qr-copy">
                <h3 className="connection-dialog__qr-title">{t('monitorConnection.qrTitle')}</h3>
                <p className="connection-dialog__qr-body">{t('monitorConnection.qrBody')}</p>
                <Button type="button" variant="outline" onClick={copyUrl}>
                  {t('monitorConnection.copy')}
                </Button>
                {copied && (
                  <span className="connection-dialog__copied" role="status">
                    {t('monitorConnection.copied')}
                  </span>
                )}
              </div>
            </div>
            <div className="connection-dialog__actions">
              <Button type="button" variant="outline" disabled={busy} onClick={onEdit}>
                {t('monitorConnection.edit')}
              </Button>
              <Button type="button" variant="outline" disabled={busy} onClick={onStop}>
                {saving ? t('monitorConnection.stopping') : t('monitorConnection.stop')}
              </Button>
            </div>
            <aside className="connection-dialog__note">
              <h3>{t('monitorConnection.protectTitle')}</h3>
              <p>{t('monitorConnection.protectBody')}</p>
            </aside>
          </div>
        ) : (
          FORM_STATUSES.includes(status) && (
            <form className="connection-dialog__form" onSubmit={submit} noValidate>
              {progress && (
                <div className="connection-dialog__progress" role="status">
                  <h3>{progress.title}</h3>
                  <p>{progress.body}</p>
                </div>
              )}
              <div className="connection-dialog__field">
                <Label htmlFor={ids.token}>{t('monitorConnection.token')}</Label>
                <Input
                  id={ids.token}
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={t('monitorConnection.tokenPlaceholder')}
                  value={values.token}
                  disabled={busy}
                  onChange={set('token')}
                />
              </div>
              <p className="connection-dialog__hint">{t('monitorConnection.tokenNote')}</p>
              <div className="connection-dialog__field">
                <Label htmlFor={ids.email}>{t('monitorConnection.email')}</Label>
                <Input
                  id={ids.email}
                  type="email"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={t('monitorConnection.emailPlaceholder')}
                  value={values.email}
                  disabled={busy}
                  onChange={set('email')}
                />
              </div>
              <div className="connection-dialog__field">
                <Label htmlFor={ids.domain}>{t('monitorConnection.domain')}</Label>
                <Input
                  id={ids.domain}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={t('monitorConnection.domainPlaceholder')}
                  value={values.domain}
                  disabled={busy}
                  onChange={set('domain')}
                />
              </div>
              {status === 'failed' ? (
                <div className="connection-dialog__failure" role="alert">
                  <p className="connection-dialog__error">
                    {error ?? t('monitorConnection.failedTitle')}
                  </p>
                  <p className="connection-dialog__hint connection-dialog__hint--body">
                    {t('monitorConnection.failedBody')}
                  </p>
                </div>
              ) : (
                <>
                  {error && (
                    <p className="connection-dialog__error" role="alert">
                      {error}
                    </p>
                  )}
                  {!progress && (
                    <aside className="connection-dialog__note">
                      <h3>{t('monitorConnection.restrictTitle')}</h3>
                      <p>{t('monitorConnection.restrictBody')}</p>
                    </aside>
                  )}
                </>
              )}
              <div className="connection-dialog__submit">
                <Button type="submit" disabled={busy}>
                  {status === 'stopping'
                    ? t('monitorConnection.stopping')
                    : busy
                      ? t('monitorConnection.connecting')
                      : status === 'failed'
                        ? t('monitorConnection.retry')
                        : t('monitorConnection.save')}
                </Button>
              </div>
            </form>
          )
        )}
      </DialogContent>
    </Dialog>
  );
}
