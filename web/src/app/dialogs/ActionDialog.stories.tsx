import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, within } from 'storybook/test';
import { makeEpic, makeTask } from '../../../.storybook/support/fixtures';
import { modalDocsParameters } from '../../../.storybook/support/modal-docs';
import { ActionDialog } from './ActionDialog';

const task = makeTask({ id: 42, taskStatus: 'todo' });
const epic = makeEpic({ id: 'release', name: 'Release plan' });
const meta: Meta<typeof ActionDialog> = {
  title: 'Task/Dialogs/ActionDialog',
  component: ActionDialog,
  parameters: { layout: 'fullscreen', ...modalDocsParameters },
  args: {
    action: { kind: 'request' },
    onClose: fn(),
    onSubmit: fn(async () => {}),
    tasks: [task],
    epicApi: {
      addImages: fn(async () => {}),
      removeImage: fn(async () => {}),
      save: fn(async () => {}),
      savePriority: fn(async () => {}),
      enterDraft: fn(async () => epic),
      leaveDraft: fn(async () => {}),
      remove: fn(async () => {}),
    },
    onOpenTask: fn(),
  },
};
export default meta;
type Story = StoryObj<typeof meta>;
export const Request: Story = {};
export const Edit: Story = { args: { action: { kind: 'edit', task } } };
export const Epic: Story = {
  args: { action: { kind: 'epic', epic } },
  play: async () => {
    await expect(within(document.body).getByRole('dialog')).toBeInTheDocument();
  },
};
