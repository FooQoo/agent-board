import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { FIXED_NOW } from '../../../../.storybook/support/fixtures';
import { StatusBar } from '@/shared/ui/status-bar/StatusBar';
import { health } from '../fixtures';
import { ResidentIndicator } from './ResidentFooter';

// The board footer with ONE indicator in the StatusBar slot between the count and the sync state:
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

/** Stopped with auto-start on: a ring and the generic label. */
export const Stopped: Story = {
  args: {
    health: health({ autoStart: { tool: 'codex', projectId: 'a'.repeat(32), model: null } }),
  },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('button', { name: 'Resident session: stopped' }),
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
