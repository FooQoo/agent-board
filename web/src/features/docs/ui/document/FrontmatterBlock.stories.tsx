import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { FrontmatterBlock } from './FrontmatterBlock';

const meta = {
  title: 'Docs/Document/FrontmatterBlock',
  component: FrontmatterBlock,
  args: {
    source: '---\ntitle: Tasks (requirements)\ntags: [product, spec]\nstatus: draft\n---\n',
  },
} satisfies Meta<typeof FrontmatterBlock>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Folded at first with its item count; it opens to show the lines and folds again. */
export const WithFrontmatter: Story = {
  play: async ({ canvasElement }) => {
    const view = within(canvasElement);
    const head = view.getByRole('button', { name: /Front matter/ });
    await expect(head).toHaveTextContent('3 items');
    await expect(head).toHaveAttribute('aria-expanded', 'false');
    await expect(view.getByText(/title: Tasks/)).not.toBeVisible();
    await userEvent.click(head);
    await expect(view.getByText(/title: Tasks/)).toBeVisible();
    await userEvent.click(head);
    await expect(view.getByText(/title: Tasks/)).not.toBeVisible();
  },
};
