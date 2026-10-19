import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { makeTask } from '../../../../.storybook/support/fixtures';
import { DeleteConfirm } from './DeleteConfirm';

const meta: Meta<typeof DeleteConfirm> = {
  title: 'Task/Dialogs/DeleteConfirm',
  component: DeleteConfirm,
  args: {
    task: makeTask({ id: 27, title: 'Retire old endpoint' }),
    saving: false,
    focusOnMount: false,
    onCancel: fn(),
    onConfirm: fn(async () => true),
  },
};
export default meta;
type Story = StoryObj<typeof meta>;
export const ConfirmDelete: Story = {
  play: async ({ args }) => {
    const view = within(document.body);
    await userEvent.click(view.getByRole('button', { name: 'Delete' }));
    await expect(args.onConfirm).toHaveBeenCalledTimes(1);
  },
};
export const FailedRetry: Story = {
  args: { onConfirm: fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true) },
  play: async ({ args }) => {
    const view = within(document.body);
    const confirm = view.getByRole('button', { name: 'Delete' });
    await userEvent.click(confirm);
    await expect(await view.findByRole('alert')).toBeInTheDocument();
    await userEvent.click(confirm);
    await expect(args.onConfirm).toHaveBeenCalledTimes(2);
  },
};
export const Archive: Story = { args: { action: 'archive' } };
