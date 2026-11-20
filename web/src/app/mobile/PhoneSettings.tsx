import type { ReactNode } from 'react';
import { parseAsString, useQueryState } from 'nuqs';
import { SettingsDialog } from '../../features/settings/ui/SettingsDialog';
import type { PreferencesEndpoint } from '../../shared/preferences';
import type { SettingsSlotState } from '../../shared/ui/app-header/Header';
import { TutorialEntryRow } from '../onboarding/TutorialEntryRow';
import { requestTutorial } from '../onboarding/tutorialRequest';
import { NotificationSettingsRow } from '../notificationSlot';
import { ResidentSettingsRow } from '../residentSlot';

/**
 * The settings dialog of the board's phone screen: the language and theme, and the row that shows
 * the guide again, the resident-session row, and the notifications row, as on the PC board.
 * The notification dialog the row opens also holds the control that turns notifications on. The remote connection is set up on a PC, so it is not here.
 */
export function PhoneSettings({
  open,
  onOpenChange,
  restoreFocusRef,
  preferencesEndpoint,
  residentRow,
  notificationRow,
}: SettingsSlotState & {
  preferencesEndpoint?: PreferencesEndpoint;
  /** Replaces the row wired to the local API (for Stories, which may not call it). */
  residentRow?: ReactNode;
  /** Replaces the notifications row (for Stories). */
  notificationRow?: ReactNode;
}) {
  // The project the board shows, from the same `project` query the board reads.
  const [projectId] = useQueryState('project', parseAsString);
  return (
    <SettingsDialog
      open={open}
      onOpenChange={onOpenChange}
      restoreFocusRef={restoreFocusRef}
      preferencesEndpoint={preferencesEndpoint}
      kind="sheet"
      extra={
        <>
          <div className="settings__entries">
            <TutorialEntryRow
              onStart={() => {
                onOpenChange(false);
                requestTutorial();
              }}
            />
            {residentRow ?? (
              <ResidentSettingsRow projectId={projectId} onClose={() => onOpenChange(false)} />
            )}
            {notificationRow ??
              (preferencesEndpoint ? (
                <NotificationSettingsRow onClose={() => onOpenChange(false)} />
              ) : null)}
          </div>
        </>
      }
    />
  );
}
