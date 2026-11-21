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

/** A person's draft is a card like any other: it sits in Todo with the draft badge, and counts in the lane. */
export const PersonDraftInTodo: Story = {
  args: {
    tasks: [
      ...(meta.args.tasks ?? []),
      makeTask({ id: 25, title: 'Person draft task', taskStatus: 'todo', draft: 'human' }),
    ],
  },
  play: async ({ canvasElement }) => {
    const todo = within(canvasElement).getByRole('region', { name: 'Todo' });
    await expect(within(todo).getByText(/Person draft task/)).toBeVisible();
    await expect(todo.querySelector('.lane-header__count')).toHaveTextContent('2');
  },
};

const backlogTasks = [
  makeTask({ id: 31, title: 'Plan the release notes', taskStatus: 'backlog' }),
  makeTask({
    id: 32,
    title: 'Plan the migration guide',
    taskStatus: 'backlog',
    openQuestionIds: ['Q-5'],
  }),
  makeTask({ id: 33, title: 'Plan the demo', taskStatus: 'backlog' }),
];

/** The Backlog is the first lane: its count and cards are apart from Todo, and no AI draft badge shows. */
export const BacklogLane: Story = {
  args: { tasks: [...backlogTasks, ...(meta.args.tasks ?? [])], onSend: fn(() => true) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const backlog = canvas.getByRole('region', { name: 'Backlog' });
    await expect(backlog.querySelector('.lane-header__count')).toHaveTextContent('3');
    await expect(within(backlog).getByText('Open question')).toBeVisible();
    await expect(canvas.queryByText(/AI draft/i)).toBeNull();
    const todo = canvas.getByRole('region', { name: 'Todo' });
    await expect(todo.querySelector('.lane-header__count')).toHaveTextContent('1');
  },
};

/** The lane header's button starts the selection mode: a circle on each card, and the bar sends the picked ones. */
export const SelectionAndSend: Story = {
  args: { tasks: [...backlogTasks, ...(meta.args.tasks ?? [])], onSend: fn(() => true) },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Select cards to send to Todo' }));
    await userEvent.click(canvas.getByRole('checkbox', { name: 'Select #31' }));
    await userEvent.click(canvas.getByRole('button', { name: /Plan the demo/ }));
    await expect(canvas.getByText('2 selected')).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Send to Todo (2)' }));
    await expect(args.onSend).toHaveBeenCalledWith([31, 33], 'todo');
    await expect(canvas.queryByRole('checkbox')).toBeNull();
  },
};

/** A send that needs a confirmation keeps the selection until the screen answers. */
export const SendWaitsForConfirmation: Story = {
  args: { tasks: [...backlogTasks, ...(meta.args.tasks ?? [])], onSend: fn(() => false) },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Select cards to send to Todo' }));
    await userEvent.click(canvas.getByRole('checkbox', { name: 'Select #32' }));
    await userEvent.click(canvas.getByRole('button', { name: 'Send to Todo (1)' }));
    await expect(args.onSend).toHaveBeenCalledWith([32], 'todo');
    await expect(canvas.getByRole('checkbox', { name: 'Select #32' })).toBeChecked();
  },
};
