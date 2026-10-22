import { describe, expect, it } from 'vitest';
import { LruCache } from './lruCache';

describe('LruCache', () => {
  it('drops the least recently used entry beyond the count limit', () => {
    const cache = new LruCache<string>({ maxEntries: 3, maxBytes: 1000 });
    cache.set('a', 'A', 1);
    cache.set('b', 'B', 1);
    cache.set('c', 'C', 1);
    expect(cache.get('a')).toBe('A'); // a is now the most recent
    cache.set('d', 'D', 1);
    expect(cache.has('b')).toBe(false);
    expect([...cache.keys()]).toEqual(['c', 'a', 'd']);
    expect(cache.size).toBe(3);
  });

  it('drops old entries until the total size fits', () => {
    const cache = new LruCache<string>({ maxEntries: 50, maxBytes: 100 });
    cache.set('a', 'A', 40);
    cache.set('b', 'B', 40);
    cache.set('c', 'C', 40);
    expect(cache.has('a')).toBe(false);
    expect(cache.bytes).toBe(80);
    cache.set('d', 'D', 100);
    expect([...cache.keys()]).toEqual(['d']);
    expect(cache.bytes).toBe(100);
  });

  it('does not keep one entry larger than the whole budget', () => {
    const cache = new LruCache<string>({ maxEntries: 50, maxBytes: 100 });
    cache.set('a', 'A', 10);
    cache.set('big', 'B', 101);
    expect(cache.has('big')).toBe(false);
    expect(cache.has('a')).toBe(true);
  });

  it('replaces an entry and accounts its new size', () => {
    const cache = new LruCache<string>({ maxEntries: 5, maxBytes: 100 });
    cache.set('a', 'A', 50);
    cache.set('a', 'A2', 10);
    expect(cache.bytes).toBe(10);
    expect(cache.get('a')).toBe('A2');
  });

  it('deletes and clears', () => {
    const cache = new LruCache<string>({ maxEntries: 5, maxBytes: 100 });
    cache.set('a', 'A', 10);
    cache.delete('a');
    expect(cache.size).toBe(0);
    expect(cache.bytes).toBe(0);
  });
});
