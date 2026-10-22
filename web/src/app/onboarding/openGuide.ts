// The guide's first read: it brings the file to the point where this tab may offer the guide.

import { type GuideState, claimGuide, readGuide, recoverGuide } from './api';

/** True when a run is marked active but no tab holds its lease any more. */
function leaseLapsed(state: GuideState): boolean {
  if (state.status !== 'active') return false;
  return !state.owner || Date.parse(state.owner.leaseUntil) <= Date.now();
}

/**
 * Reads the guide and claims it for this tab when it can be offered. A tab that was closed or
 * reloaded in the middle of a run leaves the file active with a lapsed lease: that run is taken
 * back (its samples are archived) and the guide is offered again as an interrupted one. A live
 * lease belongs to another tab and is left alone.
 */
export async function openGuide(clientId: string): Promise<GuideState> {
  let current = await readGuide();
  if (leaseLapsed(current)) current = await recoverGuide();
  if (current.status === 'unseen' || current.status === 'interrupted') {
    current = await claimGuide(clientId, current.revision);
  }
  return current;
}
