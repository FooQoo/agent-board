import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
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
          'Moved to Done after the acceptance conditions were confirmed and the verification result was recorded in the task body.',
      },
    ],
  },
};

const SAMPLE_IMAGE = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><rect width="160" height="90" fill="#8590a1"/></svg>',
)}`;

/** A question and its answer read as the task body does: heading, table, code, and image. */
export const MarkdownReason: Story = {
  args: {
    resolveAttachment: () => SAMPLE_IMAGE,
    events: [
      {
        at: '2026-10-04T08:00:00.000Z',
        reason: [
          'Answered decision:',
          '## Which database?',
          '| Name | Size |\n| --- | --- |\n| `main` | 1 GB |',
          '```sh\nagboard show 12 --json\n```',
          '![Sample chart](attachment:0123456789abcdef0123456789abcdef)',
          'Selected: Keep it\nThe note keeps its line break.',
        ].join('\n\n'),
      },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('heading', { name: 'Which database?' })).toBeVisible();
    await expect(canvas.getByRole('table')).toBeVisible();
    await expect(canvas.getByRole('img', { name: 'Sample chart' })).toBeVisible();
    await expect(canvas.getByText('agboard show 12 --json')).toBeVisible();
    await expect(canvasElement.textContent).not.toContain('##');
    await expect(canvasElement.querySelector('.history__reason br')).not.toBeNull();
  },
};
