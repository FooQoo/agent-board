import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { makeEpic, makeProject, makeTask } from '../../../../.storybook/support/fixtures';
import type { ArchiveResponse } from '../../../features/tasks/api/read';
import { ArchiveList, type ArchiveListProps } from './ArchiveList';

const taskId = 51;
const taskTitle = 'Archived feature';
const archive = {
  project: makeProject(),
  version: 'v3',
  tasks: [
    makeTask({
      id: taskId,
      title: taskTitle,
      archivedAt: '2026-10-01T10:00:00Z',
      epic: makeEpic(),
    }),
  ],
  epics: [makeEpic()],
  total: 1,
} satisfies ArchiveResponse;
const pages: ArchiveListProps['pages'] = {
  data: archive,
  status: 'ready',
  fetchFailed: false,
  hasMore: false,
  loadingMore: false,
  loadMoreFailed: false,
  loadMore: fn(),
  retryMore: fn(),
  reload: fn(),
};
const meta = {
  title: 'Pages/Archive/ArchiveList',
  component: ArchiveList,
  args: { pages, selectedId: null, onSelect: fn() },
} satisfies Meta<typeof ArchiveList>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Rows: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: /Archived feature/ }));
    await expect(args.onSelect).toHaveBeenCalledWith(51);
  },
};
export const Selected: Story = { args: { selectedId: 51 } };
export const Empty: Story = {
  args: { pages: { ...pages, data: { ...archive, tasks: [], total: 0 } } },
};
export const Loading: Story = { args: { pages: { ...pages, status: 'loading', data: null } } };
export const LoadErrorAndRetry: Story = {
  args: { pages: { ...pages, status: 'error', data: null } },
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Retry' }));
    await expect(args.pages.reload).toHaveBeenCalledOnce();
  },
};
export const RefreshErrorKeepsRows: Story = { args: { pages: { ...pages, fetchFailed: true } } };
export const LoadingNextPage: Story = {
  args: { pages: { ...pages, hasMore: true, loadingMore: true } },
};
export const NextPageFailedAndRetry: Story = {
  args: { pages: { ...pages, hasMore: true, loadMoreFailed: true } },
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Retry' }));
    await expect(args.pages.retryMore).toHaveBeenCalledOnce();
  },
};
export const EndOfList: Story = {};
