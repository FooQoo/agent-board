import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { makeTask } from '../../../../.storybook/support/fixtures';
import { MoveDialog } from './MoveDialog';

const meta: Meta<typeof MoveDialog> = {
  title: 'Task/Dialogs/MoveDialog',
  component: MoveDialog,
  parameters: { layout: 'fullscreen' },
  args: {
    task: makeTask({ id: 42, title: 'Review the release' }),
    target: 'doing',
    onClose: fn(),
    onSubmit: fn(async () => {}),
  },
};
export default meta;
type Story = StoryObj<typeof meta>;
export const EmptyReasonUsesDefault: Story = {
  play: async ({ args }) => {
    const view = within(document.body);
    await userEvent.click(view.getByRole('button', { name: 'Move' }));
    await expect(args.onSubmit).toHaveBeenCalledWith({ reason: expect.stringContaining('Todo') });
  },
};
export const OptionalReason: Story = {
  play: async ({ args }) => {
    const view = within(document.body);
    const field = view.getByLabelText('Reason');
    await userEvent.clear(field);
    await userEvent.type(field, 'Move after review');
    await userEvent.click(view.getByRole('button', { name: 'Move' }));
    await expect(args.onSubmit).toHaveBeenCalledWith({ reason: 'Move after review' });
  },
};
