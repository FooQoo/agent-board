import { BellRingIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { DialogActions } from '@/shared/ui/dialog-actions';
import { Surface } from '@/shared/ui/surface/Surface';
import './push-prompt.css';

/**
 * The guide the Home Screen app shows once, asking to turn notifications on. The turn-on button
 * is the tap that lets the browser ask for the permission; "Not now" closes it for good.
 */
export function PushPromptDialogView({
  busy = false,
  failed = false,
  onEnable,
  onClose,
}: {
  busy?: boolean;
  failed?: boolean;
  onEnable: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Surface
      kind="sheet"
      title={t('pushPrompt.title')}
      closeLabel={t('dialog.close')}
      onClose={onClose}
      className="push-prompt"
      footer={
        <DialogActions>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t('pushPrompt.later')}
          </Button>
          <Button onClick={onEnable} disabled={busy}>
            {t('push.enable')}
          </Button>
        </DialogActions>
      }
    >
      <div className="push-prompt__lead">
        <BellRingIcon aria-hidden="true" />
        <p>{t('pushPrompt.body')}</p>
      </div>
      <p className="push-prompt__note">{t('pushPrompt.note')}</p>
      {failed ? (
        <p role="alert" className="push-prompt__error">
          {t('push.failed')}
        </p>
      ) : null}
    </Surface>
  );
}
