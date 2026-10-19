import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, within } from 'storybook/test';
import { makeEpic, makeTask } from '../../../.storybook/support/fixtures';
import { ActionDialog } from './ActionDialog';

const task = makeTask({ id: 42, taskStatus: 'todo' });
const epic = makeEpic({ id: 'release', name: 'Release plan' });
const meta: Meta<typeof ActionDialog> = {
  title: 'Task/Dialogs/ActionDialog',
  component: ActionDialog,
  parameters: { layout: 'fullscreen' },
  args: {
    action: { kind: 'create' },
    onClose: fn(),
    onSubmit: fn(async () => {}),
    tasks: [task],
    epics: [epic],
    epicApi: {
      addImages: fn(async () => {}),
      removeImage: fn(async () => {}),
      savePlan: fn(async () => {}),
      saveDetails: fn(async () => {}),
      savePriority: fn(async () => {}),
      remove: fn(async () => {}),
    },
    onOpenTask: fn(),
  },
};
export default meta;
type Story = StoryObj<typeof meta>;
export const Create: Story = {};
export const Request: Story = { args: { action: { kind: 'request' } } };
export const Move: Story = { args: { action: { kind: 'move', task, target: 'doing' } } };
export const Edit: Story = { args: { action: { kind: 'edit', task } } };
export const Epic: Story = {
  args: { action: { kind: 'epic', epic } },
  play: async () => {
    await expect(within(document.body).getByRole('dialog')).toBeInTheDocument();
  },
};
