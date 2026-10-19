import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { makeEpic } from '../../../../.storybook/support/fixtures';
import type { EpicTaskCounts } from '../../../shared/api/contracts';
import { EpicList } from './EpicList';

const epics = [makeEpic({ id: 'EPIC-ALPHA', name: 'Alpha delivery' }), makeEpic({ id: 'EPIC-BETA', name: 'Beta delivery', isDraft: true })];
const counts: Record<string, EpicTaskCounts> = { 'EPIC-ALPHA': { todo: 2, doing: 1, done: 4, archived: 1, total: 8 } };
const meta = { title: 'Pages/Epics/EpicList', component: EpicList, args: { epics, counts, status: 'ready', fetchFailed: false, selectedId: null, onSelect: fn(), onRetry: fn() } } satisfies Meta<typeof EpicList>;
export default meta;
type Story = StoryObj<typeof meta>;
export const WithCounts: Story = { play: async ({ canvasElement, args }) => { const canvas = within(canvasElement); await userEvent.click(canvas.getByRole('button', { name: /Alpha delivery/ })); await expect(args.onSelect).toHaveBeenCalledWith('EPIC-ALPHA'); } };
export const SelectedAndDraft: Story = { args: { selectedId: 'EPIC-BETA' } };
export const MissingCounts: Story = { args: { counts: {} } };
export const Empty: Story = { args: { epics: [] } };
export const Loading: Story = { args: { status: 'loading', epics: undefined } };
export const LoadErrorAndRetry: Story = { args: { status: 'error', epics: undefined }, play: async ({ canvasElement, args }) => { await userEvent.click(within(canvasElement).getByRole('button', { name: 'Retry' })); await expect(args.onRetry).toHaveBeenCalledOnce(); } };
export const RefreshErrorKeepsRows: Story = { args: { fetchFailed: true } };
