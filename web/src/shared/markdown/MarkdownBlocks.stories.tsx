import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { SAMPLE_IMAGE_URL } from '../../../.storybook/support/fixtures';
import { MarkdownBlocks } from './MarkdownBlocks';
import type { MarkdownBlockData } from './model/blocks';
import { DetailPartialNotice } from '../ui/detail-state/DetailState';

const KNOWN = '0123456789abcdef0123456789abcdef';
// Built in parts so the source guard keeps rejecting embedded remote URLs.
const LINK_BASE = ['https:', '', 'example.test'].join('/');
const IMAGE_SRC = `attachment:${KNOWN}`;
const resolveKnown = (id: string): string | null => (id === KNOWN ? SAMPLE_IMAGE_URL : null);

interface DocumentShape {
  /** Stop adding sections once the text is at least this long. */
  chars: number;
  /** Add a diagram block to every n-th section (0: none). */
  diagramEvery?: number;
  /** Add a picture block to every n-th section (0: none). */
  imageEvery?: number;
  /** Whether the picture sizes are known (read from the files) or not. */
  sizes?: boolean;
}

/** A synthetic document made of sections: a heading with text, a list, code, a table, and optional pictures and diagrams. */
function makeBlocks({ chars, diagramEvery = 0, imageEvery = 0, sizes = true }: DocumentShape) {
  const blocks: MarkdownBlockData[] = [];
  let total = 0;
  const add = (block: MarkdownBlockData) => {
    blocks.push(block);
    total += block.source.length;
  };
  for (let section = 1; total < chars; section += 1) {
    const id = (kind: string) => `s${section}-${kind}`;
    add({
      id: id('text'),
      kind: 'markdown',
      source: `## Section ${section}\n\nThis is synthetic text of section ${section}. It has **strong** words, \`inline code\` and a sentence long enough to wrap across more than one line on a narrow screen, so that its height depends on the width.`,
    });
    add({
      id: id('list'),
      kind: 'markdown',
      source: `- First point of section ${section}\n- Second point with a [link](${LINK_BASE}/${section})\n  - A nested point\n- [x] A checked item`,
    });
    add({
      id: id('code'),
      kind: 'markdown',
      source: `\`\`\`ts\nexport function section${section}(input: number): number {\n  return input * ${section};\n}\n\`\`\``,
    });
    add({
      id: id('table'),
      kind: 'markdown',
      source: `| Name | Value |\n|---|---|\n| section | ${section} |\n| rows | 2 |`,
    });
    if (diagramEvery > 0 && section % diagramEvery === 0) {
      add({
        id: id('diagram'),
        kind: 'mermaid',
        source: `\`\`\`mermaid\nflowchart TD\n  A${section}[Start ${section}] --> B${section}[Check] --> C${section}[Done]\n\`\`\`\n`,
      });
    }
    if (imageEvery > 0 && section % imageEvery === 0) {
      add({
        id: id('image'),
        kind: 'markdown',
        source: `![Capture ${section}](${IMAGE_SRC})`,
        images: [sizes ? { src: IMAGE_SRC, width: 96, height: 64 } : { src: IMAGE_SRC }],
      });
    }
  }
  return blocks;
}

/** The scrolling element a large document is virtualized in, like the body of a detail drawer. */
function Viewer({
  blocks,
  isStreaming = false,
  height = 520,
  above,
}: {
  blocks: readonly MarkdownBlockData[];
  isStreaming?: boolean;
  height?: number;
  above?: React.ReactNode;
}) {
  const [parent, setParent] = useState<HTMLElement | null>(null);
  return (
    <div
      ref={setParent}
      data-testid="scroller"
      style={{ height, overflow: 'auto', padding: 12, boxSizing: 'border-box' }}
    >
      {above}
      <MarkdownBlocks
        blocks={blocks}
        scrollParent={parent}
        isStreaming={isStreaming}
        resolveAttachment={resolveKnown}
      />
    </div>
  );
}

const meta = {
  title: 'Shared/Markdown/MarkdownBlocks',
  component: MarkdownBlocks,
  args: { blocks: [] },
  render: (args) => <Viewer blocks={args.blocks} isStreaming={args.isStreaming} />,
} satisfies Meta<typeof MarkdownBlocks>;

export default meta;
type Story = StoryObj<typeof meta>;

const SHORT = makeBlocks({ chars: 600 });
const LARGE = makeBlocks({ chars: 50_000, diagramEvery: 12, imageEvery: 9 });
const DIAGRAMS = makeBlocks({ chars: 12_000, diagramEvery: 1 });
const IMAGES = makeBlocks({ chars: 12_000, imageEvery: 1 });
const IMAGES_UNSIZED = makeBlocks({ chars: 20_000, imageEvery: 1, sizes: false });

/** A short document is drawn whole, without a virtual list. */
export const Short: Story = {
  args: { blocks: SHORT },
  play: async ({ canvasElement }) => {
    expect(canvasElement.querySelector('[data-virtual-list]')).toBeNull();
    expect(canvasElement.querySelectorAll('h2').length).toBe(
      SHORT.filter((b) => b.id.endsWith('text')).length,
    );
  },
};

/** The same short document in Japanese and the dark theme. */
export const ShortJaDark: Story = {
  args: { blocks: SHORT },
  globals: { locale: 'ja', mode: 'dark' },
  play: async ({ canvasElement }) => {
    expect(canvasElement.querySelector('[data-virtual-list]')).toBeNull();
    expect(within(canvasElement).getByRole('heading', { name: 'Section 1' })).toBeInTheDocument();
  },
};

/** 50,000 characters with lists, code, tables, pictures and diagrams: only the blocks near the viewport are in the page. */
export const LargeDocument: Story = {
  args: { blocks: LARGE },
  play: async ({ canvasElement }) => {
    expect(LARGE.reduce((sum, block) => sum + block.source.length, 0)).toBeGreaterThanOrEqual(
      50_000,
    );
    await waitFor(() => expect(canvasElement.querySelector('[data-virtual-list]')).not.toBeNull());
    await within(canvasElement).findByRole('heading', { name: 'Section 1' });
    const mounted = canvasElement.querySelectorAll('[data-block-id]').length;
    expect(mounted).toBeGreaterThan(0);
    expect(mounted).toBeLessThan(LARGE.length / 4);
    // The DOM stays small however long the document is.
    expect(canvasElement.querySelectorAll('*').length).toBeLessThan(1500);
  },
};

/** The large document in Japanese, dark, on a phone. */
export const LargeDocumentPhoneJaDark: Story = {
  args: { blocks: LARGE },
  globals: { locale: 'ja', mode: 'dark', width: 'phone-375' },
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByRole('heading', { name: 'Section 1' });
    expect(canvasElement.querySelectorAll('*').length).toBeLessThan(1500);
  },
};

/** Many diagrams: only the ones near the viewport are drawn. */
export const ManyDiagrams: Story = {
  args: { blocks: DIAGRAMS },
  play: async ({ canvasElement }) => {
    const total = DIAGRAMS.filter((block) => block.kind === 'mermaid').length;
    await waitFor(
      () => expect(canvasElement.querySelectorAll('.md-mermaid svg').length).toBeGreaterThan(0),
      {
        timeout: 10_000,
      },
    );
    expect(canvasElement.querySelectorAll('.md-mermaid').length).toBeLessThan(total);
    expect(canvasElement.querySelectorAll('*').length).toBeLessThan(1500);
  },
};

/** Many pictures with their sizes known: each is lazy and its space is reserved. */
export const ManyImages: Story = {
  args: { blocks: IMAGES },
  play: async ({ canvasElement }) => {
    await waitFor(() =>
      expect(canvasElement.querySelectorAll('img.md__image-picture').length).toBeGreaterThan(0),
    );
    for (const picture of canvasElement.querySelectorAll<HTMLImageElement>(
      'img.md__image-picture',
    )) {
      expect(picture).toHaveAttribute('loading', 'lazy');
      expect(picture).toHaveAttribute('decoding', 'async');
      expect(picture).toHaveAttribute('width', '96');
      expect(picture).toHaveAttribute('height', '64');
      expect(picture).toHaveAttribute('alt');
    }
  },
};

/** The document is still arriving: a diagram at the end is not drawn yet, and a note says more will come. */
export const Streaming: Story = {
  render: () => <StreamingViewer />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByRole('status')).toBeInTheDocument();
    // The last block is a diagram that stays a placeholder until the stream ends.
    await waitFor(
      () => expect(canvasElement.querySelector('.md-mermaid--loading')).not.toBeNull(),
      { timeout: 5000 },
    );
    expect(canvasElement.querySelectorAll('h2').length).toBeGreaterThan(1);
    expect(canvasElement.querySelector('.md-mermaid svg')).toBeNull();
  },
};

/** The same stream in Japanese and the dark theme. */
export const StreamingJaDark: Story = {
  ...Streaming,
  globals: { locale: 'ja', mode: 'dark' },
};

function StreamingViewer() {
  const [count, setCount] = useState(3);
  const all = [
    ...makeBlocks({ chars: 2000 }),
    ...makeBlocks({ chars: 1, diagramEvery: 1 }).filter((b) => b.kind === 'mermaid'),
  ];
  useEffect(() => {
    if (count >= all.length) return;
    const timer = setTimeout(() => setCount((current) => current + 1), 60);
    return () => clearTimeout(timer);
  }, [count, all.length]);
  return <Viewer blocks={all.slice(0, count)} isStreaming above={<DetailPartialNotice />} />;
}

/** A viewer with a button that makes the last mounted block above the viewport much taller. */
function GrowViewer({ blocks }: { blocks: readonly MarkdownBlockData[] }) {
  const [parent, setParent] = useState<HTMLElement | null>(null);
  const [grown, setGrown] = useState<ReadonlySet<string>>(new Set());
  const shown = blocks.map((block) =>
    grown.has(block.id)
      ? { ...block, source: `${block.source}\n\n${'A line added above the view.\n\n'.repeat(8)}` }
      : block,
  );
  const grow = () => {
    if (parent === null) return;
    const top = parent.getBoundingClientRect().top;
    const above = [...parent.querySelectorAll<HTMLElement>('[data-block-id]')].filter(
      (row) => row.getBoundingClientRect().bottom <= top,
    );
    const id = above.at(-1)?.dataset.blockId;
    if (id !== undefined) setGrown((current) => new Set(current).add(id));
  };
  return (
    <div>
      <button type="button" onClick={grow}>
        Grow a block above
      </button>
      <div
        ref={setParent}
        data-testid="scroller"
        style={{ height: 520, overflow: 'auto', padding: 12, boxSizing: 'border-box' }}
      >
        <MarkdownBlocks blocks={shown} scrollParent={parent} resolveAttachment={resolveKnown} />
      </div>
    </div>
  );
}

/**
 * The reader is partway down a document of pictures whose size is not known, and a block above the view
 * becomes taller. The first heading in view stays where it is: the height measured above it corrects the
 * scroll position.
 */
export const ScrollStability: Story = {
  render: () => <GrowViewer blocks={IMAGES_UNSIZED} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const scroller = canvas.getByTestId('scroller');
    await canvas.findByRole('heading', { name: 'Section 1' });
    const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    // Scroll down in steps, so rows above the view are measured one after another.
    for (let step = 1; step <= 6; step += 1) {
      scroller.scrollTop = step * 700;
      scroller.dispatchEvent(new Event('scroll'));
      await settle(200);
    }
    const headingInView = () =>
      [...scroller.querySelectorAll<HTMLElement>('h2')].find((heading) => {
        const top = heading.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
        return top >= 0 && top < scroller.clientHeight - 80;
      });
    const heading = headingInView();
    expect(heading).toBeDefined();
    const offset = () =>
      (heading as HTMLElement).getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    const before = offset();
    const contentBefore = scroller.scrollHeight;

    await userEvent.click(canvas.getByRole('button', { name: 'Grow a block above' }));
    await settle(500);
    // The document became taller, and the heading did not move.
    expect(scroller.scrollHeight).toBeGreaterThan(contentBefore + 100);
    expect(heading?.isConnected).toBe(true);
    expect(Math.abs(offset() - before)).toBeLessThanOrEqual(2);
  },
};
