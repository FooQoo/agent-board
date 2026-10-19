import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { makeTask } from '../../../../.storybook/support/fixtures';
import { EditDialog } from './EditDialog';

const meta = {
  title: 'Task/Editor/EditDialog',
  component: EditDialog,
  args: {
    task: makeTask({ id: 12, isDraft: true, title: 'Edit this task' }),
    onClose: fn(),
    onSubmit: fn(async () => {}),
    renderEpicChip: (epic) => <span>{epic.name}</span>,
  },
} satisfies Meta<typeof EditDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
