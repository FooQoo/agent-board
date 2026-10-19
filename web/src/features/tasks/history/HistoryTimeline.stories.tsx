import type { Meta, StoryObj } from '@storybook/react-vite';
import { HistoryTimeline } from './HistoryTimeline';

const meta = {
  title: 'Task/History/HistoryTimeline',
  component: HistoryTimeline,
  args: {
    events: [
      { at: '2026-10-01T08:00:00.000Z', reason: 'Created task in Todo.' },
      { at: '2026-10-01T09:30:00.000Z', reason: 'Moved to Doing.' },
      { at: '2026-10-02T09:00:00.000Z', reason: 'Asked for a decision.' },
    ],
  },
} satisfies Meta<typeof HistoryTimeline>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Single: Story = {
  args: { events: [{ at: '2026-10-01T08:00:00.000Z', reason: 'Created task in Todo.' }] },
};

/** A task with no history yet shows an empty list, not a placeholder row. */
export const Empty: Story = { args: { events: [] } };

/** A long reason wraps inside its step, and the time stays on its own line above it. */
export const LongReason: Story = {
  args: {
    events: [
      {
        at: '2026-10-03T07:15:00.000Z',
        reason:
          'Moved to Done after the acceptance conditions were confirmed and the evidence was attached to the task description for review.',
      },
    ],
  },
};
