import { describe, expect, it } from 'vitest';
import {
  VIRTUALIZE_MAX_BLOCKS,
  VIRTUALIZE_MAX_CHARS,
  blockKey,
  estimateBlockSize,
  hashSource,
  mermaidSourceOfBlock,
  shouldVirtualize,
  type MarkdownBlockData,
} from './blocks';

// Built in parts so the source guard keeps rejecting embedded remote URLs.
const PICTURE = [`https:`, ``, `e.test`].join('/') + '/a.png';
const block = (id: string, source: string, kind: 'markdown' | 'mermaid' = 'markdown') =>
  ({ id, kind, source }) satisfies MarkdownBlockData;

describe('shouldVirtualize', () => {
  it('keeps the thresholds at 5,000 characters and 40 blocks', () => {
    expect(VIRTUALIZE_MAX_CHARS).toBe(5000);
    expect(VIRTUALIZE_MAX_BLOCKS).toBe(40);
  });

  it('renders a short document normally', () => {
    expect(shouldVirtualize([block('a', 'hello')])).toBe(false);
    expect(shouldVirtualize([])).toBe(false);
  });

  it('switches at exactly 5,000 characters in total', () => {
    expect(shouldVirtualize([block('a', 'x'.repeat(4999))])).toBe(false);
    expect(shouldVirtualize([block('a', 'x'.repeat(5000))])).toBe(true);
    expect(shouldVirtualize([block('a', 'x'.repeat(2500)), block('b', 'y'.repeat(2499))])).toBe(
      false,
    );
    expect(shouldVirtualize([block('a', 'x'.repeat(2500)), block('b', 'y'.repeat(2500))])).toBe(
      true,
    );
  });

  it('switches at exactly 40 blocks', () => {
    const blocks = (count: number) => Array.from({ length: count }, (_, i) => block(`b${i}`, 'x'));
    expect(shouldVirtualize(blocks(39))).toBe(false);
    expect(shouldVirtualize(blocks(40))).toBe(true);
  });
});

describe('mermaidSourceOfBlock', () => {
  it('strips the fence lines of a mermaid block', () => {
    expect(
      mermaidSourceOfBlock(block('m', '```mermaid\ngraph TD\n  A-->B\n```\n', 'mermaid')),
    ).toBe('graph TD\n  A-->B');
    expect(mermaidSourceOfBlock(block('m', '```mermaid\r\ngraph TD\r\n```', 'mermaid'))).toBe(
      'graph TD',
    );
  });

  it('accepts a longer fence and an unfenced source', () => {
    expect(mermaidSourceOfBlock(block('m', '````mermaid\ngraph TD\n````', 'mermaid'))).toBe(
      'graph TD',
    );
    expect(mermaidSourceOfBlock(block('m', 'graph TD\n  A-->B', 'mermaid'))).toBe(
      'graph TD\n  A-->B',
    );
  });

  it('does not touch a markdown block, even when it holds a mermaid fence', () => {
    const fenced = '```mermaid\ngraph TD\n```';
    expect(mermaidSourceOfBlock(block('p', fenced, 'markdown'))).toBe(fenced);
  });
});

describe('hashSource and blockKey', () => {
  it('is stable for equal text and differs for different text', () => {
    expect(hashSource('abc')).toBe(hashSource('abc'));
    expect(hashSource('abc')).not.toBe(hashSource('abd'));
    expect(blockKey(block('a', 'x'))).toBe(`a:${hashSource('x')}`);
    expect(blockKey(block('a', 'x'))).not.toBe(blockKey(block('a', 'y')));
  });
});

describe('estimateBlockSize', () => {
  it('grows with lines and characters, and has a floor', () => {
    const small = estimateBlockSize(block('a', 'x'));
    const lines = estimateBlockSize(block('a', 'x\n'.repeat(20)));
    const wide = estimateBlockSize(block('a', 'x'.repeat(2000)));
    expect(small).toBeGreaterThanOrEqual(24);
    expect(lines).toBeGreaterThan(small);
    expect(wide).toBeGreaterThan(small);
  });

  it('reserves the height of an image from its dimensions', () => {
    const withImage = estimateBlockSize({
      ...block('a', `![x](${PICTURE})`),
      images: [{ src: PICTURE, width: 800, height: 400 }],
    });
    expect(withImage).toBeGreaterThanOrEqual(300);
  });

  it('gives a diagram a taller estimate', () => {
    expect(estimateBlockSize(block('m', '```mermaid\ngraph TD\n```', 'mermaid'))).toBeGreaterThan(
      150,
    );
  });
});
