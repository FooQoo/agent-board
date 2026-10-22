import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { ConflictBanner } from './ConflictBanner';

const meta = {
  title: 'Docs/Document/ConflictBanner',
  component: ConflictBanner,
  args: { onReload: fn(), onOverwrite: fn() },
} satisfies Meta<typeof ConflictBanner>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Two choices; the reload asks before it throws the edit away, the overwrite does not. */
export const Conflict: Story = {
  play: async ({ canvasElement, args }) => {
    const view = within(canvasElement);
    await userEvent.click(view.getByRole('button', { name: 'Reload the latest' }));
    await expect(args.onReload).not.toHaveBeenCalled();
    await userEvent.click(view.getByRole('button', { name: 'Discard and reload' }));
    await expect(args.onReload).toHaveBeenCalledTimes(1);
    await userEvent.click(view.getByRole('button', { name: 'Overwrite with mine' }));
    await expect(args.onOverwrite).toHaveBeenCalledTimes(1);
  },
};

/** The overwrite is being saved: both choices are off. */
export const ConflictOverwriting: Story = {
  args: { busy: true },
  play: async ({ canvasElement }) => {
    const view = within(canvasElement);
    await expect(view.getByRole('button', { name: 'Overwriting…' })).toBeDisabled();
    await expect(view.getByRole('button', { name: 'Reload the latest' })).toBeDisabled();
  },
};
