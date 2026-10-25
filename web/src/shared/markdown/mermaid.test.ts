import { beforeEach, describe, expect, it, vi } from 'vitest';

const render = vi.fn(async (_id: string, text: string) => ({ svg: `<svg>${text}</svg>` }));
vi.mock('mermaid', () => ({ default: { initialize: vi.fn(), render } }));

import {
  MERMAID_CACHE_MAX_BYTES,
  MERMAID_CACHE_MAX_ENTRIES,
  cachedMermaid,
  clearMermaidCache,
  mermaidCacheStats,
  renderMermaid,
} from './mermaid';

const theme = { id: 't', variables: {} };

beforeEach(() => {
  clearMermaidCache();
  render.mockClear();
});

describe('Mermaid drawing cache', () => {
  it('limits the cache to 50 entries and 2 MiB', () => {
    expect(MERMAID_CACHE_MAX_ENTRIES).toBe(50);
    expect(MERMAID_CACHE_MAX_BYTES).toBe(2 * 1024 * 1024);
  });

  it('draws the same source and theme once', async () => {
    await renderMermaid('graph TD', theme);
    await renderMermaid('graph TD', theme);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('gives a finished drawing back at once', async () => {
    expect(cachedMermaid('graph TD', theme)).toBeNull();
    const result = await renderMermaid('graph TD', theme);
    expect(cachedMermaid('graph TD', theme)).toEqual(result);
  });

  it('keeps at most 50 drawings, dropping the least recently used', async () => {
    for (let index = 0; index < 60; index += 1) await renderMermaid(`graph ${index}`, theme);
    expect(mermaidCacheStats().entries).toBe(50);
    render.mockClear();
    await renderMermaid('graph 59', theme);
    expect(render).not.toHaveBeenCalled();
    await renderMermaid('graph 0', theme);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('keeps the total size of the drawings within 2 MiB', async () => {
    render.mockImplementation(async (_id, text) => ({
      svg: `<svg>${text}${'x'.repeat(800_000)}</svg>`,
    }));
    for (let index = 0; index < 6; index += 1) await renderMermaid(`graph ${index}`, theme);
    const stats = mermaidCacheStats();
    expect(stats.bytes).toBeLessThanOrEqual(MERMAID_CACHE_MAX_BYTES);
    expect(stats.entries).toBeLessThanOrEqual(2);
    render.mockImplementation(async (_id, text) => ({ svg: `<svg>${text}</svg>` }));
  });
});
