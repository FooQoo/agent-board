import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const markdownSources: string[] = [];
vi.mock('react-markdown', async (original) => {
  const module = await original<typeof import('react-markdown')>();
  return {
    ...module,
    default: (props: { children?: string }) => {
      markdownSources.push(props.children ?? '');
      return createElement(module.default, props);
    },
  };
});

const mermaidRender = vi.fn(async (_id: string, text: string) => ({
  svg: `<svg xmlns="http://www.w3.org/2000/svg"><text>${text.length}</text></svg>`,
}));
vi.mock('mermaid', () => ({ default: { initialize: vi.fn(), render: mermaidRender } }));

import { MarkdownBlocks } from './MarkdownBlocks';
import { clearMermaidCache } from './mermaid';
import type { MarkdownBlockData } from './model/blocks';

// Built in parts so the source guard keeps rejecting embedded remote URLs.
const ORIGIN = ['https:', '', 'images.test'].join('/');
const CHART = `${ORIGIN}/chart.png`;
const LINK = `${ORIGIN}/a`;

const paragraph = (id: string, text = `Paragraph ${id}`): MarkdownBlockData => ({
  id,
  kind: 'markdown',
  source: text,
});

beforeEach(() => {
  markdownSources.length = 0;
  mermaidRender.mockClear();
  clearMermaidCache();
});

describe('MarkdownBlocks (below the threshold)', () => {
  it('draws every block in one .md box, without a virtual list', () => {
    const { container } = render(
      <MarkdownBlocks blocks={[paragraph('a'), paragraph('b', '## Title')]} />,
    );
    const box = container.querySelector('.md');
    expect(box?.classList.contains('md--compact')).toBe(true);
    expect(screen.getByText('Paragraph a')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Title' })).toBeTruthy();
    expect(container.querySelector('[data-virtual-list]')).toBeNull();
  });

  it('does not virtualize a long document when there is no scroll parent', () => {
    const blocks = Array.from({ length: 60 }, (_, i) => paragraph(`b${i}`));
    const { container } = render(<MarkdownBlocks blocks={blocks} />);
    expect(container.querySelector('[data-virtual-list]')).toBeNull();
    expect(screen.getByText('Paragraph b59')).toBeTruthy();
  });

  it('does not parse the earlier blocks again when a block is added', () => {
    const { rerender } = render(
      <MarkdownBlocks blocks={[paragraph('a'), paragraph('b')]} isStreaming />,
    );
    expect(markdownSources).toEqual(['Paragraph a', 'Paragraph b']);
    markdownSources.length = 0;
    rerender(
      <MarkdownBlocks blocks={[paragraph('a'), paragraph('b'), paragraph('c')]} isStreaming />,
    );
    expect(markdownSources).toEqual(['Paragraph c']);
    markdownSources.length = 0;
    rerender(
      <MarkdownBlocks
        blocks={[paragraph('a'), paragraph('b'), paragraph('c'), paragraph('d')]}
        isStreaming={false}
      />,
    );
    expect(markdownSources).toEqual(['Paragraph d']);
  });

  it('parses a block again only when its text changes', () => {
    const { rerender } = render(<MarkdownBlocks blocks={[paragraph('a', 'one')]} />);
    markdownSources.length = 0;
    rerender(<MarkdownBlocks blocks={[paragraph('a', 'one')]} />);
    expect(markdownSources).toEqual([]);
    rerender(<MarkdownBlocks blocks={[paragraph('a', 'two')]} />);
    expect(markdownSources).toEqual(['two']);
  });
});

describe('MarkdownBlocks images', () => {
  const source = `![A chart](${CHART})`;

  it('draws a picture lazily with its size and alt text', () => {
    const { container } = render(
      <MarkdownBlocks
        blocks={[
          {
            id: 'i',
            kind: 'markdown',
            source,
            images: [{ src: CHART, width: 640, height: 320 }],
          },
        ]}
      />,
    );
    const image = container.querySelector('img.md__image-picture') as HTMLImageElement;
    expect(image.getAttribute('loading')).toBe('lazy');
    expect(image.getAttribute('decoding')).toBe('async');
    expect(image.getAttribute('width')).toBe('640');
    expect(image.getAttribute('height')).toBe('320');
    expect(image.getAttribute('alt')).toBe('A chart');
  });

  it('sets no size or aspect ratio when the size is unknown', () => {
    const { container } = render(
      <MarkdownBlocks blocks={[{ id: 'i', kind: 'markdown', source }]} />,
    );
    const image = container.querySelector('img.md__image-picture') as HTMLImageElement;
    expect(image.hasAttribute('width')).toBe(false);
    expect(image.hasAttribute('height')).toBe(false);
    expect(image.style.aspectRatio).toBe('');
    expect(image.getAttribute('loading')).toBe('lazy');
    expect(image.getAttribute('decoding')).toBe('async');
  });
});

describe('MarkdownBlocks diagrams', () => {
  const diagram = (id: string, text = '```mermaid\ngraph TD\n  A-->B\n```'): MarkdownBlockData => ({
    id,
    kind: 'mermaid',
    source: text,
  });

  it('strips the fence of a mermaid block before it is drawn', async () => {
    render(<MarkdownBlocks blocks={[diagram('m')]} />);
    await waitFor(() => expect(mermaidRender).toHaveBeenCalledTimes(1));
    expect(mermaidRender.mock.calls[0]?.[1]).toBe('graph TD\n  A-->B');
  });

  it('draws a mermaid fence inside a markdown block from the fence text', async () => {
    render(<MarkdownBlocks blocks={[paragraph('p', '```mermaid\ngraph LR\n  X-->Y\n```')]} />);
    await waitFor(() => expect(mermaidRender).toHaveBeenCalledTimes(1));
    expect(mermaidRender.mock.calls[0]?.[1]).toBe('graph LR\n  X-->Y');
  });

  it('waits for the end of the stream before it draws the last block', async () => {
    const blocks = [paragraph('a'), diagram('m')];
    const { rerender } = render(<MarkdownBlocks blocks={blocks} isStreaming />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(mermaidRender).not.toHaveBeenCalled();
    expect(document.querySelector('.md-mermaid--loading')).not.toBeNull();
    rerender(<MarkdownBlocks blocks={[...blocks, paragraph('z')]} isStreaming />);
    await waitFor(() => expect(mermaidRender).toHaveBeenCalledTimes(1));
  });
});

describe('MarkdownBlocks (virtualized)', () => {
  function scroller(height: number) {
    const element = document.createElement('div');
    Object.defineProperty(element, 'offsetHeight', { value: height, configurable: true });
    Object.defineProperty(element, 'offsetWidth', { value: 600, configurable: true });
    element.getBoundingClientRect = () => new DOMRect(0, 0, 600, height);
    document.body.append(element);
    return element;
  }

  // jsdom has no layout: every row would measure 0 px high, so rows are given a height of 40 px.
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.hasAttribute('data-block-id') ? 40 : 0;
    });
    return () => vi.restoreAllMocks();
  });

  const many = (count: number) => Array.from({ length: count }, (_, i) => paragraph(`b${i}`));

  it('mounts only the blocks near the viewport', async () => {
    const parent = scroller(600);
    const { container } = render(<MarkdownBlocks blocks={many(200)} scrollParent={parent} />);
    await screen.findByText('Paragraph b0');
    const list = container.querySelector('[data-virtual-list]') as HTMLElement;
    expect(list).not.toBeNull();
    const mounted = list.querySelectorAll('[data-block-id]').length;
    expect(mounted).toBeGreaterThan(0);
    expect(mounted).toBeLessThan(60);
    expect(screen.queryByText('Paragraph b199')).toBeNull();
  });

  it('keeps the block that holds the focus mounted after it scrolls out of view', async () => {
    const parent = scroller(600);
    const blocks = [
      { id: 'f', kind: 'markdown', source: `[focus me](${LINK})` } as const,
      ...many(150),
    ];
    render(<MarkdownBlocks blocks={blocks} scrollParent={parent} />);
    const link = (await screen.findByRole('link', { name: 'focus me' })) as HTMLAnchorElement;
    act(() => link.focus());
    parent.scrollTop = 4000;
    await act(async () => {
      fireEvent.scroll(parent);
    });
    await waitFor(() => expect(screen.queryByText('Paragraph b0')).toBeNull());
    expect(screen.getByRole('link', { name: 'focus me' })).toBe(link);
    expect(document.activeElement).toBe(link);
  });
});
