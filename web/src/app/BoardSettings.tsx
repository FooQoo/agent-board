import { useState } from 'react';
import { ConnectionEntryRow } from '../features/monitor-connections/ui/ConnectionEntryRow';
import { ConnectionSettings } from '../features/monitor-connections/ui/ConnectionSettings';
import { SettingsDialog } from '../features/settings/ui/SettingsDialog';
import { readToken } from '../shared/api/http';
import { TutorialEntryRow } from './onboarding/TutorialEntryRow';
import { requestTutorial } from './onboarding/tutorialRequest';
import type { PreferencesEndpoint } from '../shared/preferences';
import type { SettingsSlotState } from '../shared/ui/app-header/Header';

/** The board saves the language and theme on its own server; the sample-data mode has none. */
const boardPreferences: PreferencesEndpoint | undefined =
  import.meta.env.MODE === 'mock' ? undefined : { url: '/api/preferences', token: readToken };

/**
 * The settings dialog of the PC board and the mobile connection dialog its entry row opens.
 * The two dialogs are siblings: the settings dialog closes before the connection dialog opens,
 * so only one of them is ever on the screen.
 */
export function BoardSettings({ open, onOpenChange, restoreFocusRef }: SettingsSlotState) {
  const [connectionOpen, setConnectionOpen] = useState(false);
  return (
    <>
      <SettingsDialog
        open={open}
        onOpenChange={onOpenChange}
        restoreFocusRef={restoreFocusRef}
        preferencesEndpoint={boardPreferences}
        extra={
          <>
            <TutorialEntryRow
              onStart={() => {
                onOpenChange(false);
                requestTutorial();
              }}
            />
            <ConnectionEntryRow
              onOpen={() => {
                onOpenChange(false);
                setConnectionOpen(true);
              }}
            />
          </>
        }
      />
      <ConnectionSettings
        open={connectionOpen}
        onOpenChange={setConnectionOpen}
        restoreFocusRef={restoreFocusRef}
      />
    </>
  );
}
