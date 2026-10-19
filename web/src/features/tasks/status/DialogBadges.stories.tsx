import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import type { ColumnName, RunState } from '../../../shared/api/contracts';
import { RunStatusBadge, TaskStatusBadge } from './DialogBadges';

const taskStatuses: ColumnName[] = ['todo', 'doing', 'done'];
const runStatuses: RunState[] = ['idle', 'running', 'pending'];
const meta = {
  title: 'Task/Status/DialogBadges',
  parameters: { layout: 'centered' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const TaskStatuses: Story = {
  render: () => (
    <div className="flex gap-2">
      {taskStatuses.map((status) => (
        <TaskStatusBadge key={status} status={status} />
      ))}
    </div>
  ),
  play: async ({ canvasElement }) => {
    const view = within(canvasElement);
    await expect(view.getByText('Todo')).toBeInTheDocument();
    await expect(view.getByText('Doing')).toBeInTheDocument();
    await expect(view.getByText('Done')).toBeInTheDocument();
  },
};

export const RunStatuses: Story = {
  render: () => (
    <div className="flex gap-2">
      {runStatuses.map((status) => (
        <RunStatusBadge key={status} status={status} />
      ))}
    </div>
  ),
  play: async ({ canvasElement }) => {
    const view = within(canvasElement);
    await expect(view.getByText('Idle')).toBeInTheDocument();
    await expect(view.getByText('Running')).toBeInTheDocument();
    await expect(view.getByText('Pending')).toBeInTheDocument();
  },
};
