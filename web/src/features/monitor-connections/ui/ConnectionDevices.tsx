import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { DialogActions } from '@/shared/ui/dialog-actions';
import type { ConnectionDevice } from './connectionTypes';

export interface ConnectionDevicesProps {
  devices: ConnectionDevice[];
  /** The connection is paused: say that registered phones come back on resume. */
  paused?: boolean;
  /** A save or stop request is in flight. */
  busy?: boolean;
  onRemove?: (id: string) => void;
  onBack: () => void;
}

function formatTime(value: string, language: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(
    date,
  );
}

/**
 * The phones that were registered with the passcode and open the board without it. Removing one
 * ends its sessions at once, so it needs the passcode again.
 */
export function ConnectionDevices({
  devices,
  paused = false,
  busy = false,
  onRemove,
  onBack,
}: ConnectionDevicesProps) {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage === 'ja' ? 'ja' : 'en';
  return (
    <div className="connection-dialog__main" data-testid="devices">
      <div className="connection-dialog__body">
        <div className="connection-dialog__devices">
          <h3>{t('monitorConnection.devices.title')}</h3>
          <p>{t('monitorConnection.devices.body')}</p>
          {paused && <p>{t('monitorConnection.devices.pausedNote')}</p>}
          {devices.length === 0 ? (
            <p className="connection-dialog__devices-empty">
              {t('monitorConnection.devices.empty')}
            </p>
          ) : (
            <ul className="connection-dialog__device-list">
              {devices.map((device) => (
                <li key={device.id} className="connection-dialog__device">
                  <div className="connection-dialog__device-text">
                    <span className="connection-dialog__device-name">{device.label}</span>
                    <span className="connection-dialog__device-meta">
                      {t('monitorConnection.devices.registered', {
                        time: formatTime(device.createdAt, language),
                      })}
                      {' · '}
                      {t('monitorConnection.devices.lastUsed', {
                        time: formatTime(device.lastSeenAt, language),
                      })}
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="s"
                    className="connection-dialog__stop"
                    disabled={busy}
                    aria-label={t('monitorConnection.devices.removeLabel', { name: device.label })}
                    onClick={() => onRemove?.(device.id)}
                  >
                    {t('monitorConnection.devices.remove')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <div className="connection-dialog__footer">
        <DialogActions>
          <Button type="button" variant="outline" onClick={onBack}>
            {t('monitorConnection.devices.back')}
          </Button>
        </DialogActions>
      </div>
    </div>
  );
}
