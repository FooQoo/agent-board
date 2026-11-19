import { BellIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SettingsEntryRow } from '@/shared/ui/settings-entry-row';
import { needsHomeScreen, type PushSupport, type PushView } from '../state';

/**
 * The settings row for notifications on this phone. It explains why they are not available, how
 * to allow them again after a refusal, and offers the turn-on and turn-off buttons. The board
 * works the same in every state.
 */
export function PushEntryRow({
  view,
  support,
  busy = false,
  failed = false,
  onEnable,
  onDisable,
}: {
  view: Exclude<PushView, 'hidden'>;
  support: PushSupport;
  busy?: boolean;
  failed?: boolean;
  onEnable: () => void;
  onDisable: () => void;
}) {
  const { t } = useTranslation();
  const body = failed
    ? t('push.failed')
    : view === 'unsupported'
      ? t(needsHomeScreen(support) ? 'push.unsupportedIos' : 'push.unsupported')
      : t(`push.${view}Body`);
  const action = view === 'off' ? t('push.enable') : view === 'on' ? t('push.disable') : undefined;
  return (
    <SettingsEntryRow
      icon={BellIcon}
      title={t('push.title')}
      body={body}
      action={action}
      disabled={busy}
      onOpen={view === 'on' ? onDisable : onEnable}
    />
  );
}
