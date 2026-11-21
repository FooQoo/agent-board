import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { BacklogBanner } from './BacklogBanner';

const meta = {
  title: 'Task/Detail/BacklogBanner',
  component: BacklogBanner,
  args: { busy: false, onSend: fn() },
} satisfies Meta<typeof BacklogBanner>;
export default meta;
type Story = StoryObj<typeof meta>;

/** A plan in the Backlog says it is not started, and sends it to Todo. */
export const Default: Story = {
  play: async ({ canvasElement, args }) => {
    const banner = within(canvasElement).getByRole('region', { name: 'Backlog' });
    await expect(within(banner).getByText(/not started yet/)).toBeVisible();
    await userEvent.click(within(banner).getByRole('button', { name: 'Send to Todo' }));
    await expect(args.onSend).toHaveBeenCalledOnce();
  },
};

/** While a send runs the button waits. */
export const Busy: Story = {
  args: { busy: true },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('button', { name: 'Send to Todo' }),
    ).toBeDisabled();
  },
};
