import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { EditorStatus } from './EditorStatus';
import { StateChip } from './StateChip';

const meta = {
  title: 'Editor/PreviewStates',
  parameters: { layout: 'padded' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** The two chips beside the dialog title: the draft lock and a running agent. */
export const Chips: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 12, padding: 16 }}>
      <StateChip kind="draft" />
      <StateChip kind="running" />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const view = within(canvasElement);
    await expect(view.getByText('Draft')).toBeInTheDocument();
    await expect(view.getByText('Running')).toBeInTheDocument();
  },
};

/** The footer lines: an error over the lock line, and a plain note. */
export const StatusLines: Story = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 16 }}>
      <EditorStatus
        lines={[
          { tone: 'error', text: 'An agent changed this task while it was open.' },
          { tone: 'lock', text: "Agents can't change this task until you save." },
        ]}
      />
      <EditorStatus lines={[{ tone: 'info', text: 'Read-only while an agent is working.' }]} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const view = within(canvasElement);
    await expect(view.getByText(/An agent changed this task/)).toBeInTheDocument();
    await expect(view.getByText(/Agents can't change this task/)).toBeInTheDocument();
    await expect(view.getByText(/Read-only while an agent/)).toBeInTheDocument();
  },
};
