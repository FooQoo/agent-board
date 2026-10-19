import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { makeEpic, makeTask } from '../../../../.storybook/support/fixtures';
import { TaskCardContent, TaskCardView } from './TaskCard';

const meta = {
  title: 'Task/Card/TaskCard',
  component: TaskCardView,
  args: { task: makeTask({ id: 42, title: 'Review the component split', taskStatus: 'doing', agentStatus: 'running' }), selected: false, onSelect: fn() },
  render: (args) => <TaskCardView {...args} />,
} satisfies Meta<typeof TaskCardView>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Selected: Story = {
  args: { selected: true },
  play: async ({ canvasElement }) => expect(within(canvasElement).getByRole('button')).toHaveAttribute('aria-current', 'true'),
};
export const Draft: Story = { args: { task: makeTask({ id: 43, isDraft: true }) } };
export const PendingWithEpic: Story = {
  args: {
    task: makeTask({ id: 44, agentStatus: 'pending', pendingReason: 'Waiting for a decision.', epic: makeEpic() }),
    renderEpic: (epic) => <button type="button" onClick={(event) => { event.stopPropagation(); }}>#{epic.id}</button>,
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Waiting for a decision.')).toBeInTheDocument();
    const buttons = canvas.getAllByRole('button', { name: /e1a2b3c4/ });
    const epicButton = buttons.at(-1);
    if (!epicButton) throw new Error('Epic button was not rendered.');
    await userEvent.click(epicButton);
    await expect(args.onSelect).not.toHaveBeenCalled();
  },
};

const contentMeta = { title: 'Task/Card/TaskCardContent', component: TaskCardContent, args: { task: makeTask({ id: 42, title: 'Review the component split' }) } } satisfies Meta<typeof TaskCardContent>;
export const Content: StoryObj<typeof contentMeta> = { render: (args) => <TaskCardContent {...args} /> };
