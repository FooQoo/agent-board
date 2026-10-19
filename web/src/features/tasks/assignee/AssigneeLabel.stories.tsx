import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { AssigneeLabel } from './AssigneeLabel';

const meta = {
  title: 'Task/Assignee/AssigneeLabel',
  component: AssigneeLabel,
  args: { assignee: 'ai' },
  argTypes: { assignee: { control: 'radio', options: ['ai', 'human'] } },
} satisfies Meta<typeof AssigneeLabel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Ai: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('img', { name: 'AI' })).toBeInTheDocument();
  },
};

export const Human: Story = {
  args: { assignee: 'human' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('img', { name: 'User' })).toBeInTheDocument();
  },
};
