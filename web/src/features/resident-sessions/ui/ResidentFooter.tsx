import { useTranslation } from 'react-i18next';
import type { SessionHealth } from '../api';
import { deriveState, footerVisible, toolName } from '../state';
import { FOOTER_POLL_MS, useResidentSession } from '../useResidentSession';
import { requestResidentDialog } from '../events';
import { useStateLabel } from './StateBadge';
import './resident.css';

/**
 * The single indicator for the board footer: one dot for the one session. On the PC it is a button
 * that opens the dialog; on the remote view it is display-only, because launching and stopping are
 * local-only. Hidden while nothing is launched and auto-start is off.
 */
export function ResidentIndicator({
  health,
  onOpen,
  withState = false,
}: {
  health: SessionHealth;
  /** Absent on the remote view. */
  onOpen?: () => void;
  /** Say the state in words after the tool name, for a line that has no tooltip to hover. */
  withState?: boolean;
}) {
  const { t } = useTranslation();
  const label = useStateLabel();
  if (!footerVisible(health)) return null;
  const state = deriveState(health);
  const name = health.tool ? toolName(health.tool) : t('resident.footerLabel');
  const text =
    state === 'stopped'
      ? t('resident.footerStopped')
      : t('resident.footerState', { tool: name, state: label(state) });
  const inner = (
    <>
      <span>{state === 'stopped' ? t('resident.footerLabel') : name}</span>
      {withState && <span className="resident-footer__state">{label(state, true)}</span>}
      <span className="resident-footer__dot" aria-hidden="true" />
    </>
  );
  return onOpen ? (
    <button
      type="button"
      className="resident-footer"
      data-state={state}
      aria-label={text}
      title={text}
      onClick={onOpen}
    >
      {inner}
    </button>
  ) : (
    <span className="resident-footer" data-state={state} role="img" aria-label={text} title={text}>
      {inner}
    </span>
  );
}

/** The indicator wired to the sessions route; `remote` makes it display-only. */
export function ConnectedResidentIndicator({
  projectId,
  remote,
  withState = false,
}: {
  projectId: string;
  remote: boolean;
  withState?: boolean;
}) {
  const { snapshot } = useResidentSession(projectId, FOOTER_POLL_MS);
  if (!snapshot) return null;
  return (
    <ResidentIndicator
      health={snapshot.health}
      onOpen={remote ? undefined : requestResidentDialog}
      withState={withState}
    />
  );
}
