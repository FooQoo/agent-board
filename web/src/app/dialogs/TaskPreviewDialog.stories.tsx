import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, within } from 'storybook/test';
import { makeProject, makeTask } from '../../../.storybook/support/fixtures';
import { modalDocsParameters } from '../../../.storybook/support/modal-docs';
import { TaskPreviewDialog } from './TaskPreviewDialog';

const task = makeTask({ id: 42, taskStatus: 'todo' });
const meta: Meta<typeof TaskPreviewDialog> = {
  title: 'Task/Dialogs/TaskPreviewDialog',
  component: TaskPreviewDialog,
  parameters: { layout: 'fullscreen', ...modalDocsParameters },
  args: {
    task,
    projectId: makeProject().id,
    renderEpicChip: () => null,
    loadTask: fn(async () => task),
    onChanged: fn(),
    onClose: fn(),
    onSubmit: fn(async () => {}),
  },
};
export default meta;
type Story = StoryObj<typeof meta>;

/** The preview of a card that is not running: it opens in the editor frame. */
export const Default: Story = {
  play: async () => {
    await expect(within(document.body).getByRole('dialog')).toBeInTheDocument();
  },
};
