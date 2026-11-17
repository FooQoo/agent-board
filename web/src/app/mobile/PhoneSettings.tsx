import { SettingsDialog } from '../../features/settings/ui/SettingsDialog';
import type { PreferencesEndpoint } from '../../shared/preferences';
import type { SettingsSlotState } from '../../shared/ui/app-header/Header';
import { TutorialEntryRow } from '../onboarding/TutorialEntryRow';
import { requestTutorial } from '../onboarding/tutorialRequest';

/**
 * The settings dialog of the board's phone screen: the language and theme, and the row that shows
 * the guide again, as on the PC board. The remote connection is set up on a PC, so it is not here.
 */
export function PhoneSettings({
  open,
  onOpenChange,
  restoreFocusRef,
  preferencesEndpoint,
}: SettingsSlotState & { preferencesEndpoint?: PreferencesEndpoint }) {
  return (
    <SettingsDialog
      open={open}
      onOpenChange={onOpenChange}
      restoreFocusRef={restoreFocusRef}
      preferencesEndpoint={preferencesEndpoint}
      extra={
        <div className="settings__entries">
          <TutorialEntryRow
            onStart={() => {
              onOpenChange(false);
              requestTutorial();
            }}
          />
        </div>
      }
    />
  );
}
