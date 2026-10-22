// The cache of the data core: Summaries by project and Details by task or epic, one entry per
// section. It knows nothing of the network. A section is whole only after `commit`; what a
// running stream has received so far is `partial` and never becomes `data` on its own.
import type { ProjectId } from '../../api/contracts';
import type { DetailSection, Summary } from '../api/contracts';
import { LIMITS } from './limits';
import {
  ABSENT_RESOURCE,
  ABSENT_SECTION,
  keyOf,
  pickEviction,
  SECTIONS,
  type StoreLimits,
} from './store-parts';
import { sizeOf, SummaryCache } from './summary-cache';
import type {
  ResourceKey,
  ResourceSnapshot,
  SectionDataMap,
  SectionSnapshot,
  SummarySnapshot,
} from './types';

export { keyOf, type StoreLimits };

interface Record {
  key: ResourceKey;
  snapshot: ResourceSnapshot;
  used: number;
}

export class ResourceStore {
  private readonly limits: StoreLimits;
  private readonly records = new Map<string, Record>();
  private readonly summaries: SummaryCache;
  private readonly pins = new Map<string, number>();
  private readonly listeners = new Set<() => void>();
  private tick = 0;

  constructor(limits: StoreLimits = LIMITS) {
    this.limits = limits;
    this.summaries = new SummaryCache(limits.summaryProjects);
  }

  // ---- subscription (for `useSyncExternalStore`)

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private emit(): void {
    for (const listener of [...this.listeners]) listener();
  }

  // ---- Summary: kept in a cache of its own, passed through here for one subscription

  getSummary(projectId: ProjectId): SummarySnapshot {
    return this.summaries.get(projectId);
  }

  beginSummary(projectId: ProjectId): void {
    this.summaries.begin(projectId);
    this.emit();
  }

  commitSummary(projectId: ProjectId, summary: Summary): void {
    this.summaries.commit(projectId, summary);
    this.emit();
  }

  failSummary(projectId: ProjectId, error: Error): void {
    this.summaries.fail(projectId, error);
    this.emit();
  }

  /** A Summary fetch was dropped without an error. */
  discardSummary(projectId: ProjectId): void {
    this.summaries.discard(projectId);
    this.emit();
  }

  markSummaryStale(projectId: ProjectId): boolean {
    const changed = this.summaries.markStale(projectId);
    if (changed) this.emit();
    return changed;
  }

  touchSummary(projectId: ProjectId): void {
    this.summaries.touch(projectId);
  }

  // ---- Detail

  getResource(key: ResourceKey): ResourceSnapshot {
    return this.records.get(keyOf(key))?.snapshot ?? ABSENT_RESOURCE;
  }

  getSection<S extends DetailSection>(key: ResourceKey, section: S): SectionSnapshot<S> {
    return this.getResource(key)[section] as SectionSnapshot<S>;
  }

  /** The keys of the resources that hold at least one whole section. */
  cachedKeys(projectId?: ProjectId): ResourceKey[] {
    const out: ResourceKey[] = [];
    for (const rec of this.records.values()) {
      if (projectId !== undefined && rec.key.projectId !== projectId) continue;
      if (this.hasData(rec)) out.push(rec.key);
    }
    return out;
  }

  /** The sections of a resource that hold a whole version. */
  cachedSections(key: ResourceKey): DetailSection[] {
    const snap = this.getResource(key);
    return SECTIONS.filter((s) => snap[s].data !== null);
  }

  private hasData(rec: Record): boolean {
    return SECTIONS.some((s) => rec.snapshot[s].data !== null);
  }

  private record(key: ResourceKey): Record {
    const id = keyOf(key);
    let rec = this.records.get(id);
    if (!rec) {
      rec = { key, snapshot: ABSENT_RESOURCE, used: ++this.tick };
      this.records.set(id, rec);
    }
    return rec;
  }

  private patch(key: ResourceKey, section: DetailSection, change: Partial<SectionSnapshot>): void {
    const rec = this.record(key);
    const prev = rec.snapshot[section] as SectionSnapshot;
    rec.snapshot = { ...rec.snapshot, [section]: { ...prev, ...change } };
  }

  private prune(key: ResourceKey): void {
    const id = keyOf(key);
    const rec = this.records.get(id);
    if (!rec || this.pins.has(id)) return;
    if (SECTIONS.every((s) => rec.snapshot[s].state === 'absent')) this.records.delete(id);
  }

  /** A fetch starts: a section with a whole version refreshes, any other loads. */
  begin(key: ResourceKey, sections: DetailSection[]): void {
    for (const s of sections) {
      const prev = this.getSection(key, s);
      this.patch(key, s, {
        state: prev.data !== null ? 'refreshing' : 'loading',
        partial: null,
        error: null,
      });
    }
    this.emit();
  }

  /** What a running stream has received so far. It is shown, never kept. */
  setPartial<S extends DetailSection>(
    key: ResourceKey,
    section: S,
    partial: SectionDataMap[S],
  ): void {
    this.patch(key, section, { partial });
    this.emit();
  }

  /** The only way a section becomes whole. */
  commit<S extends DetailSection>(
    key: ResourceKey,
    section: S,
    data: SectionDataMap[S],
    version: string,
  ): void {
    this.patch(key, section, {
      state: 'ready',
      data,
      partial: null,
      version,
      error: null,
      bytes: sizeOf(data),
    });
    this.record(key).used = ++this.tick;
    this.enforce(key.kind, keyOf(key));
    this.emit();
  }

  /** A fetch failed: the whole version stays (stale), or the section is an error. */
  fail(key: ResourceKey, sections: DetailSection[], error: Error): void {
    for (const s of sections) {
      const prev = this.getSection(key, s);
      this.patch(key, s, { state: prev.data !== null ? 'stale' : 'error', partial: null, error });
    }
    this.emit();
  }

  /** A fetch was dropped without an error: back to what the cache held before it. */
  discardPartial(key: ResourceKey, sections: DetailSection[]): void {
    for (const s of sections) {
      const prev = this.getSection(key, s);
      if (prev.state === 'absent') continue;
      const state =
        prev.state === 'refreshing' ? 'stale' : prev.state === 'loading' ? 'absent' : prev.state;
      this.patch(key, s, { state, partial: null });
    }
    this.prune(key);
    this.emit();
  }

  /** Only a whole section can go stale; an absent one stays absent. */
  markStale(key: ResourceKey, section: DetailSection): boolean {
    if (this.getSection(key, section).state !== 'ready') return false;
    this.patch(key, section, { state: 'stale' });
    this.emit();
    return true;
  }

  /** The version of a stale section was confirmed to be the current one. */
  markFresh(key: ResourceKey, section: DetailSection): void {
    if (this.getSection(key, section).state !== 'stale') return;
    this.patch(key, section, { state: 'ready', error: null });
    this.emit();
  }

  markAllStale(): void {
    this.summaries.markAllStale();
    for (const rec of this.records.values()) {
      for (const s of SECTIONS) {
        if (rec.snapshot[s].state === 'ready') this.patch(rec.key, s, { state: 'stale' });
      }
    }
    this.emit();
  }

  /** Drops a resource; a pinned one stays as an empty, pinned entry. */
  remove(key: ResourceKey): void {
    const pinned = this.pins.has(keyOf(key));
    const entry = { ...ABSENT_SECTION, pinned };
    const rec = this.records.get(keyOf(key));
    if (!rec) return;
    if (pinned) rec.snapshot = { document: entry, history: entry };
    else this.records.delete(keyOf(key));
    this.emit();
  }

  /** Keeps a resource that is on screen or being edited out of the eviction. */
  pin(key: ResourceKey): () => void {
    const id = keyOf(key);
    this.pins.set(id, (this.pins.get(id) ?? 0) + 1);
    this.setPinned(key, true);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const left = (this.pins.get(id) ?? 1) - 1;
      if (left > 0) return void this.pins.set(id, left);
      this.pins.delete(id);
      this.setPinned(key, false);
      this.prune(key);
      this.enforce(key.kind, null);
      this.emit();
    };
  }

  private setPinned(key: ResourceKey, pinned: boolean): void {
    if (pinned || this.records.has(keyOf(key))) {
      for (const s of SECTIONS) this.patch(key, s, { pinned });
    }
    this.emit();
  }

  isPinned(key: ResourceKey): boolean {
    return this.pins.has(keyOf(key));
  }

  touch(key: ResourceKey): void {
    const rec = this.records.get(keyOf(key));
    if (rec) rec.used = ++this.tick;
  }

  // ---- limits

  private enforce(kind: ResourceKey['kind'], keep: string | null): void {
    const limit = kind === 'task' ? this.limits.taskDetail : this.limits.epicDetail;
    for (;;) {
      const victim = pickEviction(
        this.records.values(),
        kind,
        limit,
        (id) => id === keep || this.pins.has(id),
      );
      if (victim === null) return;
      this.records.delete(keyOf(victim.key));
    }
  }
}
