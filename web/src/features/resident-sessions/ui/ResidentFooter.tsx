import { CirclePauseIcon, TriangleAlertIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { SessionHealth } from '../api';
import { deriveState, footerVisible, toolName, waitingOn } from '../state';
import { FOOTER_POLL_MS, useResidentSession } from '../useResidentSession';
import { requestResidentDialog } from '../events';
import { useStateLabel } from './StateBadge';
import { splitStalled, useStalledName } from './StalledNotice';
import './resident.css';

/**
 * The single indicator for the board footer: one dot for the one session, before the tool name. On the PC it is a button
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
  const stalledName = useStalledName();
  if (!footerVisible(health)) return null;
  const state = deriveState(health);
  const onTasks = waitingOn(health).length > 0;
  const name = health.tool ? toolName(health.tool) : t('resident.footerLabel');
  const { failed, onHold } = splitStalled(health);
  const base =
    state === 'stopped'
      ? t('resident.footerStopped')
      : t('resident.footerState', { tool: name, state: label(state, false, onTasks) });
  const parts = [base];
  if (failed.length > 0) {
    parts.push(`${t('resident.stalledTitle')}: ${failed.map(stalledName).join(', ')}`);
  }
  if (onHold.length > 0) {
    parts.push(`${t('resident.holdTitle')}: ${onHold.map(stalledName).join(', ')}`);
  }
  const text = parts.join('. ');
  const inner = (
    <>
      <span className="resident-footer__dot" aria-hidden="true" />
      <span>{state === 'stopped' ? t('resident.footerLabel') : name}</span>
      {withState && <span className="resident-footer__state">{label(state, true, onTasks)}</span>}
      {failed.length > 0 && (
        <span className="resident-footer__stalled">
          <TriangleAlertIcon aria-hidden="true" />
          {onOpen && <span>{t('resident.footerStalled', { count: failed.length })}</span>}
        </span>
      )}
      {onHold.length > 0 && (
        <span className="resident-footer__hold">
          <CirclePauseIcon aria-hidden="true" />
          {onOpen && <span>{t('resident.footerHold', { count: onHold.length })}</span>}
        </span>
      )}
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
