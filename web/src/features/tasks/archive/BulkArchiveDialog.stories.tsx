import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { makeTask } from '../../../../.storybook/support/fixtures';
import { modalDocsParameters } from '../../../../.storybook/support/modal-docs';
import { BulkArchiveDialog } from './BulkArchiveDialog';
const targets = [makeTask({ id: 31 }), makeTask({ id: 32, assignee: 'human' })];
const meta: Meta<typeof BulkArchiveDialog> = {
  title: 'Task/Dialogs/BulkArchiveDialog',
  component: BulkArchiveDialog,
  parameters: { layout: 'fullscreen', ...modalDocsParameters },
  args: {
    projectName: 'sample-project',
    targets,
    saving: false,
    onConfirm: fn(async () => {}),
    onCancel: fn(),
  },
};
export default meta;
type Story = StoryObj<typeof meta>;
export const TwoTargets: Story = {
  play: async ({ args }) => {
    const view = within(document.body);
    await expect(view.getByRole('table')).toBeInTheDocument();
    await userEvent.click(view.getByRole('button', { name: /archive 2/i }));
    await expect(args.onConfirm).toHaveBeenCalledTimes(1);
  },
};
export const LongScrollableList: Story = {
  args: {
    targets: Array.from({ length: 30 }, (_, index) =>
      makeTask({ id: index + 1, title: `Task ${index + 1}` }),
    ),
  },
};
export const RetryAfterConflict: Story = {
  render: (args) => {
    let attempt = 0;
    return (
      <BulkArchiveDialog
        {...args}
        onConfirm={async () => {
          await args.onConfirm();
          if (attempt++ === 0) throw new Error('Conflict');
        }}
      />
    );
  },
  play: async ({ args }) => {
    const view = within(document.body);
    const confirm = view.getByRole('button', { name: /archive 2/i });
    await userEvent.click(confirm);
    await expect(await view.findByRole('alert')).toHaveTextContent('Conflict');
    await userEvent.click(confirm);
    await expect(args.onConfirm).toHaveBeenCalledTimes(2);
  },
};
