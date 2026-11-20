import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { FIXED_NOW } from '../../../../.storybook/support/fixtures';
import { StatusBar } from '@/shared/ui/status-bar/StatusBar';
import { health } from '../fixtures';
import { ResidentIndicator } from './ResidentFooter';

// The board footer with ONE indicator in the StatusBar slot, just left of the sync state:
// a filled dot is running, a ring is stopped, red is failed. On the PC it is a button that opens the
// dialog; on the remote view it is display-only. It is hidden while nothing is launched and
// auto-start is off.
const meta = {
  title: 'Resident/ResidentFooter',
  component: ResidentIndicator,
  args: { health: health({ state: 'running', tool: 'claude-code' }), onOpen: fn() },
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-end',
          height: 120,
        }}
      >
        <Story />
      </div>
    ),
  ],
  render: (args) => (
    <StatusBar
      status="ready"
      taskCount={12}
      connected
      lastSyncedAt={new Date(FIXED_NOW)}
      slot={<ResidentIndicator {...args} />}
    />
  ),
} satisfies Meta<typeof ResidentIndicator>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Working on a task on the PC: clicking the indicator asks for the dialog. */
export const Working: Story = {
  play: async ({ args, canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole('button', { name: 'Claude Code: Working on a task' }),
    );
    await expect(args.onOpen).toHaveBeenCalled();
  },
};

/** Working while it waits for a subagent or a background command to end. */
export const WaitingForSubagents: Story = {
  args: {
    health: health({
      state: 'running',
      tool: 'claude-code',
      backgroundTasks: ['Review the diff'],
    }),
  },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('button', {
        name: 'Claude Code: Working (waiting for subagents)',
      }),
    ).toBeVisible();
  },
};

/** Waiting (running with its wait registered). */
export const Waiting: Story = {
  args: { health: health({ state: 'running', waiting: true, tool: 'codex' }) },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('button', { name: 'Codex: Waiting' }),
    ).toBeVisible();
  },
};

/** Restarting after the session ended. */
export const Restarting: Story = {
  args: { health: health({ state: 'restarting', tool: 'claude-code' }) },
};

/** Failed on the PC: red. */
export const Failed: Story = {
  args: { health: health({ state: 'failed', tool: 'codex' }) },
};

/** Stalled items on the PC: a warning with the count; the tooltip names the items. */
export const Stalled: Story = {
  args: {
    health: health({
      state: 'running',
      waiting: true,
      tool: 'claude-code',
      pushStalled: [
        { kind: 'request', id: 'Q-3', attempts: 3, lastError: 'boom', onHold: false },
        { kind: 'task', id: '12', attempts: 3, lastError: 'boom', onHold: false },
      ],
    }),
  },
  play: async ({ args, canvasElement }) => {
    const button = within(canvasElement).getByRole('button', {
      name: /Some items could not be handled: Request Q-3, Task #12/,
    });
    await expect(within(button).getByText('Some items could not be handled (2)')).toBeVisible();
    await userEvent.click(button);
    await expect(args.onOpen).toHaveBeenCalled();
  },
};

/** Items the turns left unchanged (for example, waiting for a person): a neutral hold, not a warning. */
export const OnHold: Story = {
  args: {
    health: health({
      state: 'running',
      waiting: true,
      tool: 'claude-code',
      pushStalled: [{ kind: 'task', id: '583', attempts: 3, lastError: null, onHold: true }],
    }),
  },
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole('button', { name: /On hold: Task #583/ });
    await expect(within(button).getByText('On hold (1)')).toBeVisible();
    await expect(within(button).queryByText(/could not be handled/)).toBeNull();
  },
};

/** Stopped with auto-start on: a ring and the generic label. */
export const Stopped: Story = {
  args: {
    health: health({ autoStart: { tool: 'codex', projectId: 'a'.repeat(32), model: null } }),
  },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('button', { name: 'Resident agent: stopped' }),
    ).toBeVisible();
  },
};

/** Nothing launched and auto-start off: no indicator at all. */
export const Hidden: Story = {
  args: { health: health({}) },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('.resident-footer')).toBeNull();
  },
};

/** The remote (phone) view: display-only, with no button and no dialog. */
export const Remote: Story = {
  args: { health: health({ state: 'failed', tool: 'codex' }), onOpen: undefined },
  globals: { viewport: { value: 'mobile1' } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('button')).toBeNull();
    await expect(within(canvasElement).getByRole('img', { name: 'Codex: Failed' })).toBeVisible();
  },
};
