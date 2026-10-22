// One Summary fetch, and the comparison of the cache with its answer.
import type { ProjectId } from '../../api/contracts';
import type { DetailSection, DetailVersions, Summary } from '../api/contracts';
import { contradictsSummary } from './change-invalidator';
import { MAX_REFETCH_ATTEMPTS } from './limits';
import { aborted, detailId, type Flight, type FlightHost, keyOf, toError } from './refresh-types';

export async function runSummary(host: FlightHost, flight: Flight): Promise<void> {
  const { projectId } = flight;
  const previous = host.store.getSummary(projectId).data;
  host.store.beginSummary(projectId);
  const take = () => {
    const waiters = flight.waiters;
    flight.waiters = [];
    return waiters;
  };
  try {
    const summary = await host.adapter.fetchSummary(projectId, flight.controller.signal);
    if (host.disposed || flight.superseded || flight.requeue) throw aborted();
    if (
      flight.attempt + 1 < MAX_REFETCH_ATTEMPTS &&
      contradictsSummary(flight.recorded, previous, summary, host.store)
    ) {
      host.store.discardSummary(projectId);
      host.enqueue({
        kind: 'summary',
        projectId,
        key: null,
        sections: [],
        immediate: flight.immediate,
        attempt: flight.attempt + 1,
        waiters: take(),
      });
      return;
    }
    host.store.commitSummary(projectId, summary);
    reconcile(host, projectId, summary, flight.immediate);
  } catch (error) {
    if (host.disposed) {
      host.store.discardSummary(projectId);
    } else if (flight.requeue || flight.superseded) {
      host.store.discardSummary(projectId);
      host.enqueue({
        kind: 'summary',
        projectId,
        key: null,
        sections: [],
        immediate: false,
        attempt: flight.attempt,
        waiters: take(),
      });
    } else {
      host.store.failSummary(projectId, toError(error));
    }
  }
}

/**
 * Compares the cached Details with the versions the new Summary names: the ones that match are
 * whole again, the ones that differ are fetched, the ones it no longer lists are dropped. This
 * is what makes the cache right even when a notification was missed.
 */
function reconcile(
  host: FlightHost,
  projectId: ProjectId,
  summary: Summary,
  immediate: boolean,
): void {
  for (const key of host.store.cachedKeys(projectId)) {
    if (host.hasFlight(detailId(key))) continue;
    const entry =
      key.kind === 'task'
        ? summary.tasks.find((t) => t.id === key.id)
        : summary.epics.find((e) => e.id === key.id);
    if (!entry) {
      host.cancelDetail(key);
      host.store.remove(key);
      continue;
    }
    const versions = entry.detailVersions as DetailVersions;
    const differing: DetailSection[] = [];
    for (const section of host.store.cachedSections(key)) {
      const expected = versions[section];
      if (expected === undefined) continue;
      host.unverified.delete(`${keyOf(key)}|${section}`);
      if (host.store.getSection(key, section).version === expected) {
        host.store.markFresh(key, section);
      } else {
        host.store.markStale(key, section);
        differing.push(section);
      }
    }
    if (differing.length > 0) {
      host.enqueue({
        kind: 'detail',
        projectId,
        key,
        sections: differing,
        immediate,
        waiters: [],
      });
    }
  }
}
