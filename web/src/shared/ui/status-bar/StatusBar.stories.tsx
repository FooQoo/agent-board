import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { FIXED_NOW } from '../../../../.storybook/support/fixtures';
import { StatusBar } from './StatusBar';

const meta = {
  title: 'Shared/UI/StatusBar',
  component: StatusBar,
  args: {
    status: 'ready',
    taskCount: 3,
    countKind: 'board',
    connected: true,
    lastSyncedAt: new Date(FIXED_NOW),
  },
  argTypes: {
    status: { control: 'radio', options: ['loading', 'ready', 'error'] },
    countKind: { control: 'radio', options: ['board', 'archive', 'epics'] },
    connected: { control: 'boolean' },
    note: {
      control: 'select',
      options: [undefined, 'boardLoading', 'notSynced', 'noProjects', 'noSelection'],
    },
  },
} satisfies Meta<typeof StatusBar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A connected board: the card count, and the time of the last sync. The dot is the ok tone. */
export const Ready: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('3 tasks')).toBeInTheDocument();
    await expect(canvas.getByText(/^Synced \d{2}:\d{2}$/)).toBeInTheDocument();
    await expect(canvasElement.querySelector('[data-tone]')).toHaveAttribute('data-tone', 'ok');
  },
};

export const SingleTask: Story = {
  args: { taskCount: 1 },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('1 task')).toBeInTheDocument();
  },
};

export const EmptyBoard: Story = {
  args: { taskCount: 0 },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('0 tasks')).toBeInTheDocument();
  },
};

/** A lost connection keeps the last sync time and shows the warn tone. */
export const Disconnected: Story = {
  args: { connected: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/^Disconnected · Last synced \d{2}:\d{2}$/)).toBeInTheDocument();
    await expect(canvasElement.querySelector('[data-tone]')).toHaveAttribute('data-tone', 'warn');
  },
};

/** While the first sync runs, the count is a dash and the text says that it is connecting. */
export const Loading: Story = {
  args: { status: 'loading', lastSyncedAt: null },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('–')).toBeInTheDocument();
    await expect(canvas.getByText('Connecting…')).toBeInTheDocument();
    await expect(canvasElement.querySelector('[data-tone]')).toHaveAttribute('data-tone', 'idle');
  },
};

/** The first sync failed, so the bar says that the board is not connected. */
export const ConnectionError: Story = {
  args: { status: 'error', lastSyncedAt: null },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Not connected')).toBeInTheDocument();
    await expect(canvasElement.querySelector('[data-tone]')).toHaveAttribute('data-tone', 'warn');
  },
};

/** The archive screen counts archived tasks, with the plural form for more than one. */
export const ArchiveCount: Story = {
  args: { countKind: 'archive', taskCount: 2 },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('2 archived tasks')).toBeInTheDocument();
  },
};

/** The epics screen counts epics. */
export const EpicsCount: Story = {
  args: { countKind: 'epics', taskCount: 2 },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('2 epics')).toBeInTheDocument();
  },
};

/** A project state replaces the count and the sync text with one line, announced as a status. */
export const NoteBoardLoading: Story = {
  args: { note: 'boardLoading' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('status')).toHaveTextContent('Loading');
  },
};

export const NoteNotSynced: Story = {
  args: { note: 'notSynced' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('status')).toHaveTextContent('Not synced');
  },
};

export const NoteNoProjects: Story = {
  args: { note: 'noProjects' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('status')).toHaveTextContent('No projects');
  },
};

export const NoteNoSelection: Story = {
  args: { note: 'noSelection' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('status')).toHaveTextContent(
      'No project selected',
    );
  },
};

/** The same ready board in Japanese: the story's own language toolbar value is set to `ja`. */
export const JapaneseReady: Story = {
  args: { taskCount: 3 },
  globals: { locale: 'ja' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('3件')).toBeInTheDocument();
    await expect(canvas.getByText(/^同期済み \d{2}:\d{2}$/)).toBeInTheDocument();
  },
};
