// Constants and the key of the resource store.
import type { DetailSection } from '../api/contracts';
import type { ResourceKey, ResourceSnapshot, SectionSnapshot } from './types';

export interface StoreLimits {
  summaryProjects: number;
  taskDetail: { count: number; bytes: number };
  epicDetail: { count: number; bytes: number };
}

export const SECTIONS: DetailSection[] = ['document', 'history'];

export const ABSENT_SECTION: SectionSnapshot<never> = Object.freeze({
  state: 'absent',
  data: null,
  partial: null,
  version: null,
  error: null,
  pinned: false,
  bytes: 0,
}) as SectionSnapshot<never>;

export const ABSENT_RESOURCE: ResourceSnapshot = Object.freeze({
  document: ABSENT_SECTION,
  history: ABSENT_SECTION,
});

export function keyOf(key: ResourceKey): string {
  return `${key.kind}:${key.projectId}:${key.id}`;
}

interface Evictable {
  key: ResourceKey;
  snapshot: ResourceSnapshot;
  used: number;
}

/**
 * The least recently used resource to drop while the cache of `kind` is over its limit, or null
 * when it is within the limit or everything left is kept (pinned, or the one just written).
 */
export function pickEviction<R extends Evictable>(
  records: Iterable<R>,
  kind: ResourceKey['kind'],
  limit: { count: number; bytes: number },
  isKept: (id: string) => boolean,
): R | null {
  const cached = [...records].filter(
    (r) => r.key.kind === kind && SECTIONS.some((s) => r.snapshot[s].data !== null),
  );
  const bytes = cached.reduce(
    (total, r) => total + SECTIONS.reduce((n, s) => n + r.snapshot[s].bytes, 0),
    0,
  );
  if (cached.length <= limit.count && bytes <= limit.bytes) return null;
  let oldest: R | null = null;
  for (const r of cached) {
    if (isKept(keyOf(r.key))) continue;
    if (oldest === null || r.used < oldest.used) oldest = r;
  }
  return oldest;
}
