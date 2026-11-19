import type { ReactNode } from 'react';
import { parseAsString, useQueryState } from 'nuqs';
import { NotificationSettings } from '../../features/notification-settings/ui/NotificationSettings';
import { SettingsDialog } from '../../features/settings/ui/SettingsDialog';
import type { PreferencesEndpoint } from '../../shared/preferences';
import type { SettingsSlotState } from '../../shared/ui/app-header/Header';
import { TutorialEntryRow } from '../onboarding/TutorialEntryRow';
import { requestTutorial } from '../onboarding/tutorialRequest';
import { ResidentSettingsRow } from '../residentSlot';
import { PushSettingsRow } from './pushRow';

/**
 * The settings dialog of the board's phone screen: the language and theme, and the row that shows
 * the guide again, and the resident-session row, as on the PC board, and, on a page that came through the remote entrance,
 * the notifications row. The remote connection is set up on a PC, so it is not here.
 */
export function PhoneSettings({
  open,
  onOpenChange,
  restoreFocusRef,
  preferencesEndpoint,
  residentRow,
  pushRow,
}: SettingsSlotState & {
  preferencesEndpoint?: PreferencesEndpoint;
  /** Replaces the row wired to the local API (for Stories, which may not call it). */
  residentRow?: ReactNode;
  /** Replaces the notifications row wired to the entrance (for Stories). */
  pushRow?: ReactNode;
}) {
  // The project the board shows, from the same `project` query the board reads.
  const [projectId] = useQueryState('project', parseAsString);
  return (
    <SettingsDialog
      open={open}
      onOpenChange={onOpenChange}
      restoreFocusRef={restoreFocusRef}
      preferencesEndpoint={preferencesEndpoint}
      extra={
        <>
          {preferencesEndpoint ? <NotificationSettings /> : null}
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
            {pushRow ?? <PushSettingsRow />}
          </div>
        </>
      }
    />
  );
}
