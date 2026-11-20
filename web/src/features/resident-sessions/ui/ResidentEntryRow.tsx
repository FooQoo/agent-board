import { BotIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SettingsEntryRow } from '@/shared/ui/settings-entry-row';
import type { SessionsSnapshot } from '../api';
import { attachedCounts, deriveState, toolName, waitingOn } from '../state';
import { useResidentSession } from '../useResidentSession';
import { useStateLabel } from './StateBadge';

/** The one-line summary: the tool and its state, or "Not running", plus the external sessions. */
export function entrySummaryParts(snapshot: SessionsSnapshot) {
  const { health } = snapshot;
  const state = deriveState(health);
  return {
    tool: health.tool && state !== 'stopped' ? toolName(health.tool) : null,
    state,
    waitingOnTasks: waitingOn(health).length > 0,
    external: attachedCounts(snapshot).external,
  };
}

/** The row the settings dialog shows to open the resident-session dialog (the same row as the remote connection). */
export function ResidentEntryRow({
  snapshot,
  onOpen,
}: {
  snapshot: SessionsSnapshot | null;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const label = useStateLabel();
  let body = t('resident.entryUnknown');
  if (snapshot) {
    const { tool, state, waitingOnTasks, external } = entrySummaryParts(snapshot);
    body =
      (tool
        ? t('resident.entrySummary', { tool, state: label(state, true, waitingOnTasks) })
        : t('resident.entryNone')) +
      (external > 0 ? t('resident.entryExternal', { count: external }) : '');
  }
  return (
    <SettingsEntryRow
      icon={BotIcon}
      title={t('resident.entryTitle')}
      body={body}
      action={t('resident.entryAction')}
      onOpen={onOpen}
    />
  );
}

/** The row wired to the local API: it reads the sessions while the settings dialog shows it. */
export function ConnectedResidentEntryRow({
  projectId,
  onOpen,
}: {
  projectId: string;
  onOpen: () => void;
}) {
  const { snapshot } = useResidentSession(projectId, 5000);
  return <ResidentEntryRow snapshot={snapshot} onOpen={onOpen} />;
}
