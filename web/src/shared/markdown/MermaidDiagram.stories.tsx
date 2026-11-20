import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { MermaidDiagram, MermaidDiagramView } from './MermaidDiagram';

const meta = {
  title: 'Shared/Markdown/MermaidDiagram',
  component: MermaidDiagramView,
  args: { source: 'flowchart TD\n  Start --> Finish' },
} satisfies Meta<typeof MermaidDiagramView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The placeholder stays visible while the asynchronous renderer has not returned. */
export const Loading: Story = {
  args: { state: { status: 'loading' } },
  play: async ({ canvasElement }) => {
    const diagram = canvasElement.querySelector('.md-mermaid');
    expect(diagram).toHaveAttribute('aria-busy', 'true');
    expect(
      within(canvasElement).getByRole('status', { name: 'Drawing the diagram…' }),
    ).toBeInTheDocument();
  },
};

/** A renderer error is announced and the original source remains available to correct. */
export const Failed: Story = {
  args: { state: { status: 'failed', message: 'Parse error on line 1' } },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByRole('alert')).toHaveTextContent(
      'The diagram cannot be drawn: Parse error on line 1',
    );
    expect(canvasElement.querySelector('.md-mermaid__source code')?.textContent).toContain(
      'flowchart TD',
    );
  },
};

/** A finished diagram can be enlarged in a lightbox, then closed. */
export const Drawn: Story = {
  args: {
    state: {
      status: 'drawn',
      svg: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="32" viewBox="0 0 120 32"><text x="4" y="22">Start to Finish</text></svg>',
    },
  },
  play: async ({ canvasElement }) => {
    const view = within(canvasElement);
    expect(canvasElement.querySelector('.md-mermaid__svg svg')).not.toBeNull();
    await userEvent.click(view.getByRole('button', { name: 'Enlarge diagram' }));
    const page = within(document.body);
    const dialog = await page.findByRole('dialog', { name: 'Enlarge diagram' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(page.queryByRole('dialog', { name: 'Enlarge diagram' })).toBeNull();
  },
};

/** A diagram drawn by the real renderer, with labels that have descenders in English and Japanese. */
export const Rendered: Story = {
  args: { state: { status: 'loading' } },
  render: () => (
    <MermaidDiagram
      source={
        'flowchart LR\n  A[Typography gjpqy] --> B[見切れ確認 ログ]\n  B --> C{Query? gjpqy}\n  C -->|yes| D[Jumping pygmy]'
      }
    />
  ),
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByRole('button', { name: 'Enlarge diagram' });
    const svg = canvasElement.querySelector<SVGSVGElement>('.md-mermaid__svg svg');
    if (svg === null) throw new Error('The diagram was not drawn');
    const frame = svg.getBoundingClientRect();
    for (const text of Array.from(svg.querySelectorAll<SVGTextElement>('text'))) {
      const bounds = text.getBoundingClientRect();
      // The label's ink must sit inside the drawing, not be cut at its edge.
      expect(bounds.top).toBeGreaterThanOrEqual(frame.top);
      expect(bounds.bottom).toBeLessThanOrEqual(frame.bottom);
    }
  },
};
