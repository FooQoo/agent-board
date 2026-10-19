import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { makeTask } from '../../../../.storybook/support/fixtures';
import { TaskProgressRow } from './TaskProgressRow';

const meta = {
  title: 'Task/Card/TaskProgressRow',
  component: TaskProgressRow,
  args: {
    task: makeTask({ id: 41, title: 'Prepare release', taskStatus: 'doing' }),
    grip: (
      <button type="button" aria-label="Reorder task">
        ↕
      </button>
    ),
    disabled: false,
    onOpen: fn(),
  },
} satisfies Meta<typeof TaskProgressRow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
