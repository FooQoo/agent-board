// What the scheduler does with a cache invalidation: stop the fetches it outdated, queue the
// fetches it asks for, and ask for a new Summary.
import type { ProjectId } from '../../api/contracts';
import type { DetailSection } from '../api/contracts';
import type { Invalidation } from './change-invalidator';
import { detailId, type Flight, keyOf, type SchedulerHost } from './refresh-types';
import type { ResetReason, ResourceKey } from './types';

function markUnverified(host: SchedulerHost, key: ResourceKey, section: DetailSection): void {
  host.unverified.add(`${keyOf(key)}|${section}`);
}

/** A newer notification outdated the fetch: its response is not kept, the section is fetched again. */
function supersede(flight: Flight): void {
  flight.superseded = true;
  flight.controller.abort();
}

/** The cache can no longer be trusted: everything is stale until a new Summary says otherwise. */
export function resetCache(host: SchedulerHost, reason: ResetReason): void {
  if (host.disposed) return;
  host.invalidator.reset(reason);
  for (const key of host.store.cachedKeys()) {
    for (const section of host.store.cachedSections(key)) markUnverified(host, key, section);
  }
  for (const flight of host.flights.values()) {
    if (flight.kind === 'detail') supersede(flight);
  }
  for (const projectId of host.watched()) void host.loadSummary(projectId, { immediate: false });
}

export function applyInvalidation(
  host: SchedulerHost,
  projectId: ProjectId,
  inv: Invalidation,
): void {
  if (host.disposed) return;
  for (const key of inv.removed) cancelDetail(host, key);
  for (const { key, section } of inv.stale) {
    markUnverified(host, key, section);
    const flight = host.flights.get(detailId(key));
    if (flight?.sections.includes(section)) {
      supersede(flight);
    } else {
      host.enqueue({
        kind: 'detail',
        projectId: key.projectId,
        key,
        sections: [section],
        immediate: false,
        waiters: [],
      });
    }
  }
  if (inv.summary) void host.loadSummary(projectId, { immediate: false });
}

/** The resource is gone: drop its queued request and stop its fetch. */
export function cancelDetail(host: SchedulerHost, key: ResourceKey): void {
  const id = detailId(key);
  const item = host.queue.get(id);
  if (item) {
    host.queue.delete(id);
    for (const w of item.waiters) w();
  }
  const flight = host.flights.get(id);
  if (flight) {
    flight.cancelled = true;
    flight.controller.abort();
  }
}

/** Something opened: background fetches stop and wait for the gate. */
export function holdBackground(host: SchedulerHost): void {
  for (const flight of host.flights.values()) {
    if (flight.immediate) continue;
    flight.requeue = true;
    flight.controller.abort();
  }
}
