import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { makeEpic, makeTask } from '../../../../.storybook/support/fixtures';
import { Board } from './Board';

const meta = {
  title: 'Pages/Board/Board',
  component: Board,
  args: {
    message: null,
    tasks: [
      makeTask({ id: 21, title: 'Draft the plan', taskStatus: 'todo' }),
      makeTask({
        id: 22,
        title: 'Build the UI',
        taskStatus: 'doing',
        agentStatus: 'running',
        epic: makeEpic(),
      }),
      makeTask({ id: 23, title: 'Ship the change', taskStatus: 'done', assignee: 'human' }),
    ],
    selectedId: null,
    onSelect: fn(),
    onRetry: fn(),
    onMove: fn(),
    onReorder: fn(),
    onOpenEpic: fn(),
  },
} satisfies Meta<typeof Board>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ThreeLanes: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('region', { name: 'Todo' })).toBeInTheDocument();
    await userEvent.click(canvas.getByRole('button', { name: /Draft the plan/ }));
    await expect(args.onSelect).toHaveBeenCalledWith(21);
  },
};
export const Empty: Story = { args: { tasks: [] } };
export const Loading: Story = { args: { message: 'loading' } };
export const Failed: Story = {
  args: { message: 'error' },
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Retry' }));
    await expect(args.onRetry).toHaveBeenCalledOnce();
  },
};

/** AI drafts are cards like any other: they sit in Todo with the draft badge, and count in the lane. */
export const DraftsInTodo: Story = {
  args: {
    tasks: [
      ...(meta.args.tasks ?? []),
      makeTask({ id: 24, title: 'AI draft task', taskStatus: 'todo', draft: 'ai' }),
      makeTask({ id: 25, title: 'Person draft task', taskStatus: 'todo', draft: 'human' }),
    ],
  },
  play: async ({ canvasElement }) => {
    const todo = within(canvasElement).getByRole('region', { name: 'Todo' });
    await expect(within(todo).getByText(/AI draft task/)).toBeVisible();
    await expect(within(todo).getByText(/Person draft task/)).toBeVisible();
    await expect(todo.querySelector('.lane-header__count')).toHaveTextContent('3');
  },
};
