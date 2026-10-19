import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { ArchiveIcon } from 'lucide-react';
import { ListPane } from './ListPane';

const meta = {
  title: 'UI/ListPane',
  component: ListPane,
  args: {
    title: 'Archived tasks',
    countText: '1 task',
    description: 'Previously completed tasks',
    status: 'ready',
    fetchFailed: false,
    onRetry: fn(),
    empty: { icon: <ArchiveIcon />, title: 'No archived tasks' },
    hasRows: true,
    listLabel: 'Archived task list',
    loadError: 'Could not load the archive.',
    refreshError: 'Could not refresh the archive.',
    children: <div role="listitem">Task row</div>,
  },
} satisfies Meta<typeof ListPane>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Rows: Story = {
  play: async ({ canvasElement }) =>
    expect(
      within(canvasElement).getByRole('list', { name: 'Archived task list' }),
    ).toBeInTheDocument(),
};
export const Empty: Story = { args: { hasRows: false } };
export const Loading: Story = { args: { status: 'loading' } };
export const LoadError: Story = { args: { status: 'error' } };
export const RefreshError: Story = {
  args: { fetchFailed: true },
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Retry' }));
    await expect(args.onRetry).toHaveBeenCalledOnce();
  },
};
