import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { LaneHeader } from './LaneHeader';

const meta = {
  title: 'Pages/Board/LaneHeader',
  component: LaneHeader,
  args: { column: 'done', count: 3, onArchive: fn() },
} satisfies Meta<typeof LaneHeader>;
export default meta;
type Story = StoryObj<typeof meta>;
export const DoneWithArchive: Story = {
  play: async ({ canvasElement, args }) => {
    await userEvent.click(
      within(canvasElement).getByRole('button', { name: 'Archive completed tasks' }),
    );
    await expect(args.onArchive).toHaveBeenCalledOnce();
  },
};
export const EmptyDone: Story = { args: { count: 0 } };
export const Todo: Story = { args: { column: 'todo', onArchive: undefined } };
