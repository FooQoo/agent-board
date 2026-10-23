import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { MdxFrame } from './MdxFrame';

const meta = {
  title: 'Docs/Document/MdxFrame',
  component: MdxFrame,
  args: { source: '# Hello\n\n<Chart />\n' },
} satisfies Meta<typeof MdxFrame>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Storybook has no sandbox page, so the frame never answers and stays on its loading text. What
 * matters here is the isolation of the frame: scripts only, never the board's own origin.
 */
export const Loading: Story = {
  play: async ({ canvasElement }) => {
    const view = within(canvasElement);
    await expect(view.getByRole('status')).toHaveTextContent('Loading the preview…');
    const frame = view.getByTitle('MDX preview');
    await expect(frame).toHaveAttribute('sandbox', 'allow-scripts');
    await expect(frame.getAttribute('sandbox')).not.toContain('allow-same-origin');
    await expect(frame).toHaveAttribute('src', '/docs-sandbox');
  },
};

/** The loading text in Japanese. */
export const LoadingJapanese: Story = {
  globals: { locale: 'ja' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('status')).toHaveTextContent(
      'プレビューを読み込み中…',
    );
  },
};
