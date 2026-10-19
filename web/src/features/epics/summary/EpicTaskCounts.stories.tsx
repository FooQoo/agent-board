import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { EpicTaskCounts } from './EpicTaskCounts';

const meta = {
  title: 'Epic/Summary/EpicTaskCounts',
  component: EpicTaskCounts,
  args: { counts: { todo: 2, doing: 1, done: 4, archived: 3, total: 10 } },
} satisfies Meta<typeof EpicTaskCounts>;
export default meta;
type Story = StoryObj<typeof meta>;
export const AllStatuses: Story = {
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('group', { name: 'Tasks by state' }),
    ).toBeInTheDocument();
  },
};
export const MissingCounts: Story = { args: { counts: undefined } };
