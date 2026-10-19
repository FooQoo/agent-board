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
    const add = view.getByRole('button', { name: 'Add' });
    await expect(add).toBeDisabled();
    await userEvent.type(view.getByPlaceholderText('Title (up to 100 characters)'), 'A new task');
    await expect(add).toBeEnabled();
    await userEvent.click(add);
    await expect(args.onSubmit).toHaveBeenCalledTimes(1);
    await expect(args.onClose).toHaveBeenCalledTimes(1);
  },
};

export const SaveFailureRetry: Story = {
  render: (args) => {
    let attempt = 0;
    return (
      <CreateDialog
        {...args}
        onSubmit={async (input) => {
          await args.onSubmit(input);
          if (attempt++ === 0) throw new Error('temporary failure');
        }}
      />
    );
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
