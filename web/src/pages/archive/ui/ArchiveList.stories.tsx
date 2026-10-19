import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { makeEpic, makeProject, makeTask } from '../../../../.storybook/support/fixtures';
import type { ArchiveResponse } from '../../../features/tasks/api/read';
import { ArchiveList } from './ArchiveList';

const taskId = 51;
const meta = { title: 'Pages/Archive/ArchiveList', component: ArchiveList, args: { data: { project: makeProject(), version: 'v3', cursor: 'archive-cursor', tasks: [makeTask({ id: taskId, title: 'Archived feature', archivedAt: '2026-10-01T10:00:00Z', epic: makeEpic() })], epics: [makeEpic()] } satisfies ArchiveResponse, status: 'ready', fetchFailed: false, selectedId: null, onSelect: fn(), onRetry: fn() } } satisfies Meta<typeof ArchiveList>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Rows: Story = { play: async ({ canvasElement, args }) => { const canvas = within(canvasElement); await userEvent.click(canvas.getByRole('button', { name: /Archived feature/ })); await expect(args.onSelect).toHaveBeenCalledWith(51); } };
export const Selected: Story = { args: { selectedId: 51 } };
export const Empty: Story = { args: { data: { ...meta.args.data, tasks: [] } } };
export const Loading: Story = { args: { status: 'loading', data: null } };
export const LoadErrorAndRetry: Story = { args: { status: 'error', data: null }, play: async ({ canvasElement, args }) => { await userEvent.click(within(canvasElement).getByRole('button', { name: 'Retry' })); await expect(args.onRetry).toHaveBeenCalledOnce(); } };
export const RefreshErrorKeepsRows: Story = { args: { fetchFailed: true } };
