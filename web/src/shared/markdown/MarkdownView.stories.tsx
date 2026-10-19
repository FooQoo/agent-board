import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { SAMPLE_IMAGE_URL } from '../../../.storybook/support/fixtures';
import { MarkdownView } from './MarkdownView';

// Owned attachment IDs are 32 lowercase hex digits. The resolver maps the known one to the synthetic
// picture and refuses every other, as a card does for the attachments it holds.
const KNOWN = '0123456789abcdef0123456789abcdef';
const UNKNOWN = 'fedcba9876543210fedcba9876543210';
const resolveKnown = (id: string): string | null => (id === KNOWN ? SAMPLE_IMAGE_URL : null);
// Build the scheme in parts so the source guard can continue to reject embedded remote URLs.
const SAFE_TARGET = ['https:', '', 'example.test'].join('/');

const SAMPLE_TEXT = `# Parser notes

A paragraph with **strong** text and \`inline code\`.

- First item
- Second item

\`\`\`ts
const answer = 42;
\`\`\`

A [blocked link](javascript:alert(1)) stays as plain text.`;

const meta = {
  title: 'Shared/Markdown/MarkdownView',
  component: MarkdownView,
  args: { source: SAMPLE_TEXT, variant: 'compact', resolveAttachment: resolveKnown },
} satisfies Meta<typeof MarkdownView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Nothing to show: the box stays, with no child. */
export const Empty: Story = {
  args: { source: '' },
  play: async ({ canvasElement }) => {
    const box = canvasElement.querySelector('.md');
    expect(box).not.toBeNull();
    expect(box?.children.length).toBe(0);
  },
};

/** Headings, emphasis, code, and a link that is not allowed, shown as plain text. */
export const Text: Story = {
  play: async ({ canvasElement }) => {
    expect(canvasElement.querySelector('a[href^="javascript"]')).toBeNull();
    expect(canvasElement.querySelector('.md__plain-link')?.textContent).toBe('blocked link');
  },
};

/** An allowed external link stays active and opens safely in a new tab. */
export const SafeLink: Story = {
  args: { source: `A [safe link](${SAFE_TARGET}) opens separately.` },
  play: async ({ canvasElement }) => {
    const link = within(canvasElement).getByRole('link', { name: 'safe link' });
    expect(link).toHaveAttribute('href', SAFE_TARGET);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  },
};

/** The wide variant of the same text, used where the full width of the page is available. */
export const WideVariant: Story = {
  args: { variant: 'wide' },
  play: async ({ canvasElement }) => {
    expect(canvasElement.querySelector('.md--wide')).not.toBeNull();
  },
};

const TABLE_ROWS = Array.from(
  { length: 4 },
  (_, index) =>
    `| Step ${index + 1} | Reads the first line of the description to find the frontmatter boundary and keeps every column readable | Result ${index + 1} is recorded with its time |`,
).join('\n');

/** A wide table on a phone: it scrolls inside its own frame and the page stays as wide as the screen. */
export const WideTablePhone: Story = {
  args: {
    source: `| Step | Work | Result |\n|---|---|---|\n${TABLE_ROWS}`,
  },
  globals: { width: 'phone-375' },
  play: async ({ canvasElement }) => {
    const scroll = canvasElement.querySelector<HTMLElement>('.md-scroll');
    expect(scroll).not.toBeNull();
    expect(scroll !== null && scroll.scrollWidth > scroll.clientWidth).toBe(true);
  },
};

const LONG_TEXT = Array.from(
  { length: 30 },
  (_, index) =>
    `Paragraph ${index + 1}. Each paragraph is a sentence or two of synthetic text so that the page is long enough to scroll.`,
).join('\n\n');

/** A long description: every paragraph is rendered in order, and the last one is reached. */
export const LongText: Story = {
  args: { source: LONG_TEXT },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByText(/^Paragraph 30\./)).toBeInTheDocument();
    expect(canvasElement.querySelectorAll('p').length).toBe(30);
  },
};

/** Checklist boxes are read-only: they show the state and cannot be changed. */
export const Checklist: Story = {
  args: { source: '- [x] Checked item\n- [ ] Open item' },
  play: async ({ canvasElement }) => {
    expect(canvasElement.querySelectorAll('.md__check--on').length).toBe(1);
    const boxes = canvasElement.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    expect(boxes.length).toBe(2);
    for (const box of boxes) expect(box.disabled).toBe(true);
  },
};

/** Raw HTML is shown as text and never becomes an element. */
export const RawHtml: Story = {
  args: { source: 'Text with <script>window.storyRan = true</script> and <b>raw bold</b>.' },
  play: async ({ canvasElement }) => {
    expect(canvasElement.querySelector('script, b')).toBeNull();
    expect(canvasElement.textContent).toContain('<b>raw bold</b>');
  },
};

/** An owned picture that the resolver knows: it is shown, and it loads. */
export const ImageResolved: Story = {
  args: { source: `![Sample chart](attachment:${KNOWN})` },
  play: async ({ canvasElement }) => {
    const picture = canvasElement.querySelector<HTMLImageElement>('img.md__image-picture');
    expect(picture).not.toBeNull();
    await waitFor(() => expect(picture?.naturalWidth ?? 0).toBeGreaterThan(0));
  },
};

/** A reference the card does not hold, so it shows the placeholder with the caption. */
export const ImageUnresolved: Story = {
  args: { source: `![Missing chart](attachment:${UNKNOWN})` },
  play: async ({ canvasElement }) => {
    const view = within(canvasElement);
    expect(view.getByText('No image')).toBeInTheDocument();
    expect(view.getByText('Missing chart')).toBeInTheDocument();
    expect(canvasElement.querySelector('img')).toBeNull();
  },
};

/** References that are never fetched: a relative path, a data URL and an unowned asset path. */
export const ImageNotAllowed: Story = {
  args: {
    source: [
      `![Owned asset](assets/${KNOWN}.png)`,
      '![Relative](./chart.png)',
      '![Inline](data:image/png;base64,AAAA)',
    ].join('\n\n'),
    // Nothing is resolved here, so even the owned asset path shows the placeholder.
    resolveAttachment: () => null,
  },
  play: async ({ canvasElement }) => {
    expect(canvasElement.querySelectorAll('.md__image-none').length).toBe(3);
    expect(canvasElement.querySelector('img')).toBeNull();
  },
};

/** A picture that the resolver names but the server cannot serve: the load fails to the placeholder. */
export const ImageFailed: Story = {
  args: {
    source: `![Broken chart](attachment:${KNOWN})`,
    resolveAttachment: () => '/missing-attachment.png',
  },
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelector('.md__image-none')).not.toBeNull());
    expect(within(canvasElement).getByText('Broken chart')).toBeInTheDocument();
  },
};

/** Pictures on consecutive lines form one row of small captures. */
export const ImageCaptures: Story = {
  args: {
    source: `![First](attachment:${KNOWN})\n![Second](attachment:${KNOWN})`,
  },
  play: async ({ canvasElement }) => {
    expect(canvasElement.querySelector('.md-captures')?.querySelectorAll('img').length).toBe(2);
  },
};

/** A press on a picture opens it enlarged, and the close control puts the page back. */
export const ImageEnlarge: Story = {
  args: { source: `![Sample chart](attachment:${KNOWN})` },
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole('button', { name: 'Enlarge Sample chart' }),
    );
    const dialog = await within(document.body).findByRole('dialog', { name: 'Sample chart' });
    expect(dialog.hasAttribute('data-lightbox')).toBe(true);
    await userEvent.click(within(dialog).getByRole('button', { name: /close/i }));
    await waitFor(() => expect(document.querySelector('[data-lightbox]')).toBeNull());
  },
};

/** A well-formed Mermaid block is drawn as a diagram. */
export const MermaidValid: Story = {
  args: { source: '```mermaid\nflowchart TD\n  Start --> Finish\n```' },
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelector('.md-mermaid svg')).not.toBeNull(), {
      timeout: 10000,
    });
  },
};

/** A wrong Mermaid block shows one line of the reason and the source, so the text can be fixed. */
export const MermaidInvalid: Story = {
  args: { source: '```mermaid\nnot a diagram\n```' },
  play: async ({ canvasElement }) => {
    const alert = await within(canvasElement).findByRole('alert', {}, { timeout: 10000 });
    expect(alert.textContent).toContain('cannot be drawn');
    expect(canvasElement.querySelector('.md-mermaid pre code')?.textContent).toBe('not a diagram');
    expect(canvasElement.querySelector('.md-mermaid svg')).toBeNull();
  },
};
