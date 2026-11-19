import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, within } from 'storybook/test';
import { snapshotOf } from '../fixtures';
import { ResidentEntryRow } from './ResidentEntryRow';

// The row the settings dialog shows below the tutorial and the remote connection: a one-line
// summary and a button that opens the dialog.
const meta = {
  title: 'Resident/ResidentEntryRow',
  component: ResidentEntryRow,
  args: {
    snapshot: snapshotOf({ state: 'running', tool: 'claude-code' }),
    onOpen: fn(),
  },
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 560, padding: 16 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ResidentEntryRow>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Working on a task. */
export const Working: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Claude Code · working')).toBeVisible();
  },
};

/** Not running. */
export const NotRunning: Story = {
  args: { snapshot: snapshotOf({}) },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Not running')).toBeVisible();
  },
};

/** Failed, with an external session connected. */
export const FailedWithExternal: Story = {
  args: {
    snapshot: snapshotOf(
      { state: 'failed', tool: 'codex' },
      {
        sessions: [
          {
            id: 'codex:x',
            tool: 'codex',
            origin: 'external',
            connectedAt: '2026-11-19T01:00:00Z',
            lastSeenAt: '2026-11-19T01:00:00Z',
            state: 'connected',
          },
        ],
      },
    ),
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Codex · failed · External 1')).toBeVisible();
  },
};

/** Before the first read of the sessions answers. */
export const Loading: Story = { args: { snapshot: null } };
