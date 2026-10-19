import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { CreateDialog } from './CreateDialog';

const meta: Meta<typeof CreateDialog> = {
  title: 'Task/Dialogs/CreateDialog',
  component: CreateDialog,
  parameters: { layout: 'fullscreen' },
  args: { onClose: fn(), onSubmit: fn(async () => {}) },
};
export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};
export const ValidationAndSubmit: Story = {
  play: async ({ args }) => {
    const view = within(document.body);
    await userEvent.click(view.getByRole('button', { name: 'Add' }));
    await expect(view.getByRole('button', { name: 'Add' })).toBeDisabled();
    await userEvent.type(view.getByPlaceholderText('Title (up to 100 characters)'), 'A new task');
    await userEvent.click(view.getByRole('button', { name: 'Add' }));
    await expect(args.onSubmit).toHaveBeenCalledTimes(1);
    await expect(args.onClose).toHaveBeenCalledTimes(1);
  },
};

export const SaveFailureRetry: Story = {
  args: {
    onSubmit: fn()
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce(undefined),
  },
  play: async ({ args }) => {
    const view = within(document.body);
    await userEvent.type(view.getByPlaceholderText('Title (up to 100 characters)'), 'Try again');
    await userEvent.click(view.getByRole('button', { name: 'Add' }));
    await expect(await view.findByRole('alert')).toBeInTheDocument();
    await userEvent.click(view.getByRole('button', { name: 'Retry' }));
    await expect(args.onSubmit).toHaveBeenCalledTimes(2);
  },
};
