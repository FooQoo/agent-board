// One Detail stream, from the request to the commit or the discard.
import type { DetailSection, DetailVersions } from '../api/contracts';
import { MAX_REFETCH_ATTEMPTS } from './limits';
import { aborted, type Flight, type FlightHost, keyOf, toError } from './refresh-types';
import { readDetail, StreamRejected } from './stream-reader';
import type { ResourceKey, SectionDataMap } from './types';

function expectedVersions(
  host: FlightHost,
  key: ResourceKey,
  sections: DetailSection[],
): DetailVersions | undefined {
  const summary = host.store.getSummary(key.projectId);
  if (summary.state !== 'ready' || !summary.data) return undefined;
  const entry =
    key.kind === 'task'
      ? summary.data.tasks.find((t) => t.id === key.id)
      : summary.data.epics.find((e) => e.id === key.id);
  if (!entry) return undefined;
  const versions: DetailVersions = {};
  const known = entry.detailVersions as DetailVersions;
  for (const s of sections) {
    if (host.unverified.has(`${keyOf(key)}|${s}`) || known[s] === undefined) continue;
    versions[s] = known[s];
  }
  return versions;
}

export async function runDetail(host: FlightHost, flight: Flight): Promise<void> {
  const key = flight.key as ResourceKey;
  const { sections } = flight;
  host.store.begin(key, sections);
  try {
    const result = await readDetail(
      host.adapter.streamDetail({ resource: key, sections }, flight.controller.signal),
      { resource: key, sections, versions: expectedVersions(host, key, sections) },
      {
        signal: flight.controller.signal,
        onPartial: <S extends DetailSection>(section: S, data: SectionDataMap[S]) => {
          if (!flight.superseded) host.store.setPartial(key, section, data);
        },
      },
    );
    if (host.disposed || flight.superseded || flight.requeue || flight.cancelled) throw aborted();
    commitDetail(host, key, sections, result);
  } catch (error) {
    detailFailed(host, flight, error);
  }
}

function commitDetail(
  host: FlightHost,
  key: ResourceKey,
  sections: DetailSection[],
  result: {
    versions: DetailVersions;
    document?: SectionDataMap['document'];
    history?: SectionDataMap['history'];
  },
): void {
  for (const section of sections) {
    const version = result.versions[section];
    if (version === undefined) continue;
    if (section === 'document' && result.document) {
      host.store.commit(key, 'document', result.document, version);
    } else if (section === 'history' && result.history) {
      host.store.commit(key, 'history', result.history, version);
    }
    host.unverified.delete(`${keyOf(key)}|${section}`);
  }
}

function detailFailed(host: FlightHost, flight: Flight, error: unknown): void {
  const key = flight.key as ResourceKey;
  const { sections } = flight;
  const take = () => {
    const waiters = flight.waiters;
    flight.waiters = [];
    return waiters;
  };
  if (host.disposed || flight.cancelled) {
    host.store.discardPartial(key, sections);
    return;
  }
  if (flight.superseded || flight.requeue) {
    host.store.discardPartial(key, sections);
    host.enqueue({
      kind: 'detail',
      projectId: key.projectId,
      key,
      sections,
      immediate: false,
      attempt: flight.attempt,
      waiters: take(),
    });
    return;
  }
  if (
    error instanceof StreamRejected &&
    error.reason === 'version-mismatch' &&
    flight.attempt + 1 < MAX_REFETCH_ATTEMPTS
  ) {
    // The Summary is older than the server: get a new one, then ask again.
    host.store.discardPartial(key, sections);
    const waiters = take();
    void host.loadSummary(key.projectId, { immediate: flight.immediate }).then(() =>
      host.enqueue({
        kind: 'detail',
        projectId: key.projectId,
        key,
        sections,
        immediate: flight.immediate,
        attempt: flight.attempt + 1,
        waiters,
      }),
    );
    return;
  }
  host.store.fail(key, sections, toError(error));
}
