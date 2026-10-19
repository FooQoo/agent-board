import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { makeTask } from '../../../../.storybook/support/fixtures';
import { Lane } from './Lane';

const meta = { title: 'Pages/Board/Lane', component: Lane, args: { column: 'todo', tasks: [makeTask({ id: 31, title: 'First task' }), makeTask({ id: 32, title: 'Second task' })], selectedId: null, onSelect: fn() } } satisfies Meta<typeof Lane>;
export default meta;
type Story = StoryObj<typeof meta>;
export const TwoTasks: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('region', { name: 'Todo' })).toBeInTheDocument();
    await userEvent.click(canvas.getByRole('button', { name: /First task/ }));
    await expect(args.onSelect).toHaveBeenCalledWith(31);
  },
};
export const EmptyLane: Story = { args: { tasks: [] } };
