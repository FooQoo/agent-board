/**
 * A least-recently-used cache limited by the number of entries and by their total size. `get` and
 * `set` make an entry the most recent; entries are dropped from the oldest until both limits hold.
 * An entry larger than the whole size budget is not kept.
 */
export class LruCache<T> {
  private readonly entries = new Map<string, { value: T; bytes: number }>();
  private total = 0;

  constructor(private readonly limits: { maxEntries: number; maxBytes: number }) {}

  get size(): number {
    return this.entries.size;
  }

  get bytes(): number {
    return this.total;
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  keys(): IterableIterator<string> {
    return this.entries.keys();
  }

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (entry === undefined) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T, bytes: number): void {
    this.delete(key);
    if (bytes > this.limits.maxBytes) return;
    this.entries.set(key, { value, bytes });
    this.total += bytes;
    for (const [oldest, entry] of this.entries) {
      if (this.entries.size <= this.limits.maxEntries && this.total <= this.limits.maxBytes) break;
      if (oldest === key) break;
      this.entries.delete(oldest);
      this.total -= entry.bytes;
    }
  }

  delete(key: string): void {
    const entry = this.entries.get(key);
    if (entry === undefined) return;
    this.entries.delete(key);
    this.total -= entry.bytes;
  }

  clear(): void {
    this.entries.clear();
    this.total = 0;
  }
}
