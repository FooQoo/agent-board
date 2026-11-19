import { useState } from 'react';
import { parseAsString, useQueryState } from 'nuqs';
import { ConnectionEntryRow } from '../features/monitor-connections/ui/ConnectionEntryRow';
import { ConnectionSettings } from '../features/monitor-connections/ui/ConnectionSettings';
import { ConnectedResidentEntryRow } from '../features/resident-sessions/ui/ResidentEntryRow';
import { requestResidentDialog } from '../features/resident-sessions/events';
import { SettingsDialog } from '../features/settings/ui/SettingsDialog';
import { csrfHeaders, readToken } from '../shared/api/http';
import { TutorialEntryRow } from './onboarding/TutorialEntryRow';
import { requestTutorial } from './onboarding/tutorialRequest';
import { residentAvailable } from './residentSlot';
import { usesRemoteSession } from './remote/session';
import type { PreferencesEndpoint } from '../shared/preferences';
import type { SettingsSlotState } from '../shared/ui/app-header/Header';

/** The board saves the language and theme on its own server; the sample-data mode and the demo have none. */
const boardPreferences: PreferencesEndpoint | undefined =
  import.meta.env.MODE === 'mock' || import.meta.env.MODE === 'demo'
    ? undefined
    : { url: '/api/preferences', token: readToken, headers: csrfHeaders };
/** A phone connects to an `agboard serve` on this computer; the demo on a static site has none. */
const phoneConnection = import.meta.env.MODE !== 'demo';

/**
 * The settings dialog of the PC board, the remote connection dialog and the resident-session dialog its entry rows open.
 * The two dialogs are siblings: the settings dialog closes before the connection dialog opens,
 * so only one of them is ever on the screen.
 */
export function BoardSettings({ open, onOpenChange, restoreFocusRef }: SettingsSlotState) {
  const [connectionOpen, setConnectionOpen] = useState(false);
  // The project the board shows, from the same `project` query the board reads.
  const [projectId] = useQueryState('project', parseAsString);
  return (
    <>
      <SettingsDialog
        open={open}
        onOpenChange={onOpenChange}
        restoreFocusRef={restoreFocusRef}
        preferencesEndpoint={boardPreferences}
        extra={
          <div className="settings__entries">
            <TutorialEntryRow
              onStart={() => {
                onOpenChange(false);
                requestTutorial();
              }}
            />
            {phoneConnection ? (
              <ConnectionEntryRow
                onOpen={() => {
                  onOpenChange(false);
                  setConnectionOpen(true);
                }}
              />
            ) : null}
            {residentAvailable(projectId) && !usesRemoteSession() ? (
              <ConnectedResidentEntryRow
                projectId={projectId}
                onOpen={() => {
                  onOpenChange(false);
                  requestResidentDialog();
                }}
              />
            ) : null}
          </div>
        }
      />
      {phoneConnection ? (
        <ConnectionSettings
          open={connectionOpen}
          onOpenChange={setConnectionOpen}
          restoreFocusRef={restoreFocusRef}
          projectId={projectId}
        />
      ) : null}
    </>
  );
}
