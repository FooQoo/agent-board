import { useState } from 'react';
import { ConnectionEntryRow } from '../features/monitor-connections/ui/ConnectionEntryRow';
import { ConnectionSettings } from '../features/monitor-connections/ui/ConnectionSettings';
import { SettingsDialog } from '../features/settings/ui/SettingsDialog';
import type { SettingsSlotState } from '../shared/ui/app-header/Header';

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
        extra={
          <ConnectionEntryRow
            onOpen={() => {
              onOpenChange(false);
              setConnectionOpen(true);
            }}
          />
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
