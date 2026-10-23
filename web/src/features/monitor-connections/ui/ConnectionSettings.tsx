import { useConnectionController } from '../useConnectionController';
import { ConnectionSettingsView } from './ConnectionSettingsView';

/** The connection dialog, wired to the local API. The caller owns whether it is open. */
export function ConnectionSettings({
  open,
  onOpenChange,
  restoreFocusRef,
  projectId = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Where the focus goes when the dialog closes. */
  restoreFocusRef?: { current: HTMLElement | null };
  /** The project the phone opens; without one there is no QR code and no copied URL. */
  projectId?: string | null;
}) {
  const controller = useConnectionController(open, projectId);
  return (
    <ConnectionSettingsView
      open={open}
      onOpenChange={(next) => {
        if (!next) controller.cancelEdit();
        onOpenChange(next);
      }}
      restoreFocusRef={restoreFocusRef}
      status={controller.status}
      draft={controller.draft}
      tokenInfo={controller.tokenInfo}
      onDeleteToken={() => void controller.removeToken()}
      url={controller.url}
      projectSelected={controller.projectSelected}
      passcode={controller.passcode}
      qr={controller.qr}
      error={controller.error}
      saving={controller.saving}
      onConnect={(draft) => void controller.connect(draft)}
      onStop={() => void controller.stop()}
      onResetToken={controller.resetToken}
    />
  );
}
