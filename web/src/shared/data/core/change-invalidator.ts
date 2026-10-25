// Turns an SSE `changed` event into the least cache invalidation that is still safe. It marks
// sections stale in the store and reports what the scheduler should fetch; it fetches nothing.
// A missed event, a new server instance or an event it does not know makes the whole cache
// untrusted: the Summary and every Detail go stale until a new Summary says which still match.
import type { ProjectId } from '../../api/contracts';
import type { Change, ChangedEvent, DetailSection, Facet, Summary } from '../api/contracts';
import type { ResourceStore } from './resource-store';
import type { ResetReason, ResourceKey } from './types';

export interface Invalidation {
  reset: ResetReason | null;
  /** The Summary of the event's project needs a new fetch. */
  summary: boolean;
  /** Cached sections that changed. Includes a section being fetched, whose response is now old. */
  stale: Array<{ key: ResourceKey; section: DetailSection }>;
  removed: ResourceKey[];
}

const NONE = (): Invalidation => ({ reset: null, summary: false, stale: [], removed: [] });

const FACETS: readonly Facet[] = ['summary', 'document', 'history', 'deleted'];
const FOR_RESOURCE: Record<string, readonly Facet[]> = {
  project: ['summary', 'deleted'],
  task: FACETS,
  epic: FACETS,
};

export interface InvalidatorOptions {
  /** Events of other projects are ignored. */
  isActiveProject(projectId: ProjectId): boolean;
}

export class ChangeInvalidator {
  private instanceId: string | null = null;
  private seq: number | null = null;

  constructor(
    private readonly store: ResourceStore,
    private readonly options: InvalidatorOptions,
  ) {}

  /** The sequence check alone. Tells why the cache can no longer be trusted, or null. */
  observe(event: ChangedEvent): ResetReason | null {
    let reason: ResetReason | null = null;
    if (this.instanceId !== null && event.instanceId !== this.instanceId) {
      reason = 'instance-changed';
    } else if (this.seq !== null && event.seq !== this.seq + 1) {
      reason = 'seq-gap';
    } else if (!event.changes.every(known)) {
      reason = 'unknown-event';
    }
    this.instanceId = event.instanceId;
    this.seq = event.seq;
    return reason;
  }

  /** Marks what the event touched. Call after `observe` found no reason to reset. */
  apply(event: ChangedEvent): Invalidation {
    const out = NONE();
    if (!this.options.isActiveProject(event.projectId)) return out;
    for (const change of event.changes) this.applyChange(event.projectId, change, out);
    return out;
  }

  /** Both steps, for a caller that has nothing to put between them. */
  handle(event: ChangedEvent): Invalidation {
    const reason = this.observe(event);
    return reason ? this.reset(reason) : this.apply(event);
  }

  /** The cache can no longer be trusted. */
  reset(reason: ResetReason): Invalidation {
    this.store.markAllStale();
    return { reset: reason, summary: true, stale: [], removed: [] };
  }

  /** A new connection: the sequence of the old one says nothing about the new one. */
  forgetSequence(): void {
    this.seq = null;
    this.instanceId = null;
  }

  private applyChange(projectId: ProjectId, change: Change, out: Invalidation): void {
    const facets = new Set(change.facets);
    if (change.resource === 'project') {
      out.summary = true;
      return;
    }
    const key: ResourceKey =
      change.resource === 'task'
        ? { kind: 'task', projectId, id: change.id as number }
        : { kind: 'epic', projectId, id: String(change.id) };
    if (facets.has('summary')) out.summary = true;
    if (facets.has('deleted')) {
      out.summary = true;
      if (this.store.cachedKeys(projectId).some((k) => k.kind === key.kind && k.id === key.id)) {
        this.store.remove(key);
        out.removed.push(key);
      }
      return;
    }
    for (const section of ['document', 'history'] as const) {
      if (!facets.has(section)) continue;
      if (key.kind === 'epic' && section === 'history') continue;
      if (this.store.getSection(key, section).data === null) continue;
      this.store.markStale(key, section);
      out.stale.push({ key, section });
    }
  }
}

function known(change: Change): boolean {
  const allowed = FOR_RESOURCE[change.resource];
  return allowed !== undefined && change.facets.every((f) => allowed.includes(f));
}

/**
 * Whether a Summary response contradicts a notification that arrived while it was fetched: the
 * response shows no sign of a change the notification announced, so it may be older than the
 * change and must be fetched again.
 */
export function contradictsSummary(
  recorded: readonly ChangedEvent[],
  previous: Summary | null,
  next: Summary,
  store: ResourceStore,
): boolean {
  for (const event of recorded) {
    if (event.projectId !== next.project.id) continue;
    for (const change of event.changes) {
      if (change.resource === 'project') {
        if (previous && previous.version === next.version) return true;
        continue;
      }
      const entry =
        change.resource === 'task'
          ? next.tasks.find((t) => t.id === change.id)
          : next.epics.find((e) => e.id === change.id);
      const facets = change.facets;
      if (facets.includes('deleted')) {
        if (entry) return true;
        continue;
      }
      if (facets.includes('summary') && previous && previous.version === next.version) return true;
      if (!entry) continue;
      const key: ResourceKey =
        change.resource === 'task'
          ? { kind: 'task', projectId: event.projectId, id: change.id as number }
          : { kind: 'epic', projectId: event.projectId, id: String(change.id) };
      for (const section of ['document', 'history'] as const) {
        if (!facets.includes(section)) continue;
        const cached = store.getSection(key, section);
        const versions = entry.detailVersions as Partial<Record<DetailSection, string>>;
        if (cached.data !== null && cached.version === versions[section]) return true;
      }
    }
  }
  return false;
}
