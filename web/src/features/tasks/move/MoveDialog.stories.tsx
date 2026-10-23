import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { makeTask } from '../../../../.storybook/support/fixtures';
import { modalDocsParameters } from '../../../../.storybook/support/modal-docs';
import { TaskStatusChangedError } from '../api/lifecycle';
import { MoveDialog } from './MoveDialog';

const meta: Meta<typeof MoveDialog> = {
  title: 'Task/Dialogs/MoveDialog',
  component: MoveDialog,
  parameters: { layout: 'fullscreen', ...modalDocsParameters },
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
    await expect(args.onSubmit).toHaveBeenCalledWith({
      fromStatus: 'todo',
      reason: expect.stringContaining('Todo'),
    });
  },
};
export const OptionalReason: Story = {
  play: async ({ args }) => {
    const view = within(document.body);
    const field = view.getByLabelText('Reason (optional)');
    await userEvent.clear(field);
    await userEvent.type(field, 'Move after review');
    await userEvent.click(view.getByRole('button', { name: 'Move' }));
    await expect(args.onSubmit).toHaveBeenCalledWith({
      fromStatus: 'todo',
      reason: 'Move after review',
    });
  },
};

const statusMovedOn = fn(async (data: { reason: string; fromStatus: string }) => {
  if (data.fromStatus === 'todo') throw new TaskStatusChangedError('moved', 'done');
});

/**
 * Another change moved the task while the dialog was open: the move is refused, the dialog shows
 * the status the task is in now and says why, and the next move starts from that status.
 */
export const StatusChangedElsewhere: Story = {
  args: { onSubmit: statusMovedOn },
  play: async () => {
    statusMovedOn.mockClear();
    const view = within(document.body);
    await userEvent.click(view.getByRole('button', { name: 'Move' }));
    await expect(await view.findByRole('alert')).toHaveTextContent(
      'Another change moved this task to Done.',
    );
    await expect(view.getByRole('group', { name: 'Status change' })).toHaveTextContent('Done');
    await userEvent.click(view.getByRole('button', { name: 'Move' }));
    await expect(statusMovedOn).toHaveBeenLastCalledWith({
      fromStatus: 'done',
      reason: expect.stringContaining('from Done to Doing'),
    });
  },
};
