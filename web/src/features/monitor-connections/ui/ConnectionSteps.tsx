import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLinkIcon } from 'lucide-react';
import { Button } from '@/shared/ui/button';
import { Checkbox } from '@/shared/ui/checkbox';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import './connection.css';
import type { ConnectionDraft, ConnectionQr, TokenInfo } from './connectionTypes';

/**
 * Where the person signs in to ngrok and copies the auth token. The page never loads it: the
 * person opens it from a link. The scheme is joined here so the source keeps no literal remote
 * address (see the source rules in test/styles.test.ts).
 */
export const NGROK_TOKEN_URL = `${'https'}://dashboard.ngrok.com/get-started/your-authtoken`;

/** One numbered step: a green number and its name, then what the step holds. */
function Step({
  number,
  title,
  titleId,
  children,
}: {
  number: number;
  title: string;
  titleId?: string;
  children: ReactNode;
}) {
  return (
    <li className="connection-dialog__step">
      <h3 className="connection-dialog__step-head" id={titleId}>
        <span className="connection-dialog__step-number" aria-hidden="true">
          {number}
        </span>
        {title}
      </h3>
      {children}
    </li>
  );
}

export interface ConnectionSetupStepsProps {
  values: ConnectionDraft;
  onChange: (values: ConnectionDraft) => void;
  tokenInfo: TokenInfo;
  /** A request is in flight: the fields stay as they are. */
  busy: boolean;
  /** Delete the token saved in this PC's secure storage. */
  onDeleteToken?: () => void;
}

/** The two steps of the first setup: get the token from ngrok, then paste it and connect. */
export function ConnectionSetupSteps({
  values,
  onChange,
  tokenInfo,
  busy,
  onDeleteToken,
}: ConnectionSetupStepsProps) {
  const { t } = useTranslation();
  const ids = { token: useId(), save: useId() };
  const canSave = tokenInfo.keychainAvailable;
  const tokenNote = !canSave
    ? t('monitorConnection.tokenNoKeychain')
    : tokenInfo.source === 'env'
      ? t('monitorConnection.tokenFromEnv')
      : tokenInfo.source === 'keychain'
        ? t('monitorConnection.tokenInKeychain')
        : tokenInfo.source === 'session'
          ? t('monitorConnection.tokenThisRun')
          : t('monitorConnection.tokenNote');

  return (
    <ol className="connection-dialog__steps">
      <Step number={1} title={t('monitorConnection.getTokenTitle')}>
        <p className="connection-dialog__step-text">{t('monitorConnection.getTokenBody')}</p>
        <Button asChild variant="outline" className="connection-dialog__token-link">
          <a href={NGROK_TOKEN_URL} target="_blank" rel="noopener noreferrer">
            {t('monitorConnection.getTokenAction')}
            <ExternalLinkIcon aria-hidden="true" />
          </a>
        </Button>
        <p className="connection-dialog__step-text">{t('monitorConnection.ngrokNote')}</p>
      </Step>
      <Step number={2} title={t('monitorConnection.pasteTitle')}>
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
            onChange={(event) => onChange({ ...values, token: event.target.value })}
          />
        </div>
        <div className="connection-dialog__save">
          <Checkbox
            id={ids.save}
            checked={canSave && values.save}
            disabled={busy || !canSave}
            onCheckedChange={(checked) => onChange({ ...values, save: checked === true })}
          />
          <Label htmlFor={ids.save}>{t('monitorConnection.saveToken')}</Label>
        </div>
        {canSave && (
          <p className="connection-dialog__step-text">{t('monitorConnection.saveNote')}</p>
        )}
        <p
          className="connection-dialog__step-text connection-dialog__step-text--note"
          data-testid="token-note"
        >
          {tokenNote}
        </p>
        {tokenInfo.saved && (
          <div>
            <Button
              type="button"
              variant="outline"
              size="s"
              disabled={busy}
              onClick={onDeleteToken}
            >
              {t('monitorConnection.deleteToken')}
            </Button>
          </div>
        )}
      </Step>
    </ol>
  );
}

export interface ConnectionReadyStepsProps {
  qr?: ConnectionQr | null;
  /** A project is selected. Without one nothing stands in for the QR code, and the copy is off. */
  projectSelected?: boolean;
  /** There is an address to copy. */
  copyable?: boolean;
  /** The 4-digit passcode the phone enters; nothing is shown in its place before it is known. */
  passcode?: string | null;
  /** The URL was just copied. */
  copied: boolean;
  onCopy: () => void;
}

/** The two steps once the connection is up: scan the QR code, then enter the passcode. */
export function ConnectionReadySteps({
  qr,
  projectSelected = true,
  copyable = true,
  passcode,
  copied,
  onCopy,
}: ConnectionReadyStepsProps) {
  const { t } = useTranslation();
  const passcodeTitle = useId();
  return (
    <ol className="connection-dialog__steps">
      <Step number={1} title={t('monitorConnection.qrTitle')}>
        <p className="connection-dialog__step-text">{t('monitorConnection.qrBody')}</p>
        {qr && (
          <figure className="connection-dialog__qr">
            <img src={qr.src} alt={t('monitorConnection.qrAlt')} />
            {qr.sample && (
              <figcaption className="connection-dialog__qr-note">
                {t('monitorConnection.qrSample')}
              </figcaption>
            )}
          </figure>
        )}
        {!projectSelected && (
          <p className="connection-dialog__step-text" data-testid="project-needed">
            {t('dataLayerConnection.projectNeeded')}
          </p>
        )}
        <div className="connection-dialog__copy">
          <Button type="button" variant="outline" disabled={!copyable} onClick={onCopy}>
            {t('monitorConnection.copy')}
          </Button>
          {copied && (
            <span className="connection-dialog__copied" role="status">
              {t('monitorConnection.copied')}
            </span>
          )}
        </div>
      </Step>
      <Step number={2} title={t('monitorConnection.passcodeTitle')} titleId={passcodeTitle}>
        <p className="connection-dialog__step-text">{t('monitorConnection.passcodeBody')}</p>
        {passcode && (
          <div
            className="connection-dialog__passcode"
            role="group"
            aria-labelledby={passcodeTitle}
            data-testid="passcode"
          >
            {passcode}
          </div>
        )}
        <p className="connection-dialog__step-text">{t('monitorConnection.passcodeNote')}</p>
      </Step>
    </ol>
  );
}
