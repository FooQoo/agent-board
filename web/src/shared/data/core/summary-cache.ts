// The Summaries the store holds, one per project, the least recently used out over the limit.
import type { ProjectId } from '../../api/contracts';
import type { Summary } from '../api/contracts';
import type { SummarySnapshot } from './types';

/** Characters times two stands for the bytes a value takes. */
export const sizeOf = (value: unknown): number => JSON.stringify(value).length * 2;

const ABSENT: SummarySnapshot = Object.freeze({
  state: 'absent',
  data: null,
  version: null,
  error: null,
  bytes: 0,
});

interface Record {
  snapshot: SummarySnapshot;
  used: number;
}

export class SummaryCache {
  private readonly records = new Map<ProjectId, Record>();
  private tick = 0;

  constructor(private readonly limit: number) {}

  get(projectId: ProjectId): SummarySnapshot {
    return this.records.get(projectId)?.snapshot ?? ABSENT;
  }

  private set(projectId: ProjectId, snapshot: SummarySnapshot, use = false): void {
    const prev = this.records.get(projectId);
    this.records.set(projectId, { snapshot, used: use || !prev ? ++this.tick : prev.used });
  }

  begin(projectId: ProjectId): void {
    const prev = this.get(projectId);
    this.set(projectId, { ...prev, state: prev.data ? 'refreshing' : 'loading', error: null });
  }

  commit(projectId: ProjectId, summary: Summary): void {
    const snapshot: SummarySnapshot = {
      state: 'ready',
      data: summary,
      version: summary.version,
      error: null,
      bytes: sizeOf(summary),
    };
    this.set(projectId, snapshot, true);
    this.enforce(projectId);
  }

  fail(projectId: ProjectId, error: Error): void {
    const prev = this.get(projectId);
    this.set(projectId, { ...prev, state: prev.data ? 'stale' : 'error', error });
  }

  /** A fetch was dropped without an error: back to what was held before it. */
  discard(projectId: ProjectId): void {
    const prev = this.get(projectId);
    if (prev.state !== 'loading' && prev.state !== 'refreshing') return;
    if (prev.data === null) this.records.delete(projectId);
    else this.set(projectId, { ...prev, state: 'stale' });
  }

  markStale(projectId: ProjectId): boolean {
    const prev = this.get(projectId);
    if (prev.state !== 'ready') return false;
    this.set(projectId, { ...prev, state: 'stale' });
    return true;
  }

  markAllStale(): void {
    for (const id of this.records.keys()) this.markStale(id);
  }

  touch(projectId: ProjectId): void {
    const rec = this.records.get(projectId);
    if (rec) rec.used = ++this.tick;
  }

  private enforce(keep: ProjectId): void {
    while (this.records.size > this.limit) {
      let oldest: ProjectId | null = null;
      for (const [id, rec] of this.records) {
        if (id === keep) continue;
        if (oldest === null || rec.used < (this.records.get(oldest)?.used ?? 0)) oldest = id;
      }
      if (oldest === null) return;
      this.records.delete(oldest);
    }
  }
}
