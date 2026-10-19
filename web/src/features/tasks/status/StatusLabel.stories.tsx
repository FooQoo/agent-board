import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { StatusLabel } from './StatusLabel';

const meta = {
  title: 'Task/Status/StatusLabel',
  component: StatusLabel,
  args: { kind: 'card', status: 'todo' },
  argTypes: {
    kind: { control: 'radio', options: ['card', 'agent'] },
    monitor: { control: 'boolean' },
  },
} satisfies Meta<typeof StatusLabel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const CardTodo: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Todo')).toBeInTheDocument();
  },
};

export const CardDoing: Story = { args: { status: 'doing' } };

export const CardDone: Story = { args: { status: 'done' } };

export const AgentIdle: Story = { args: { kind: 'agent', status: 'idle' } };

export const AgentRunning: Story = { args: { kind: 'agent', status: 'running' } };

export const AgentPending: Story = { args: { kind: 'agent', status: 'pending' } };

/** The monitor shows the agent states with its own words. */
export const MonitorRunning: Story = { args: { kind: 'agent', status: 'running', monitor: true } };

/** The monitor shows a pending agent with its own pending wording and the pause icon. */
export const MonitorPending: Story = {
  args: { kind: 'agent', status: 'pending', monitor: true },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Pending')).toBeInTheDocument();
  },
};

/** A done card in the monitor reads as a completed lane, with the same check icon as the board. */
export const MonitorDoneLane: Story = {
  args: { kind: 'card', status: 'done', monitor: true },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Done')).toBeInTheDocument();
  },
};
