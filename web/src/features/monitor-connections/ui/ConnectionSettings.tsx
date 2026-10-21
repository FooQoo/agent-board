import { useState } from 'react';
import { useConnectionController } from '../useConnectionController';
import { ConnectionEntryRow } from './ConnectionEntryRow';
import { ConnectionSettingsView } from './ConnectionSettingsView';

/** The settings entry row and the connection dialog it opens, wired to the local API. */
export function ConnectionSettings() {
  const [open, setOpen] = useState(false);
  const controller = useConnectionController(open);
  return (
    <>
      <ConnectionEntryRow onOpen={() => setOpen(true)} />
      <ConnectionSettingsView
        open={open}
        onOpenChange={(next) => {
          if (!next) controller.cancelEdit();
          setOpen(next);
        }}
        status={controller.status}
        draft={controller.draft}
        tokenInfo={controller.tokenInfo}
        onDeleteToken={() => void controller.removeToken()}
        url={controller.url}
        passcode={controller.passcode}
        qr={controller.qr}
        error={controller.error}
        saving={controller.saving}
        onConnect={(draft) => void controller.connect(draft)}
        onStop={() => void controller.stop()}
        onEdit={controller.edit}
      />
    </>
  );
}
