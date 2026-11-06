import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { makeEpic, makeTask } from '../../../../.storybook/support/fixtures';
import type { TaskSummary } from '../../../shared/api/contracts';
import { DecisionAnswerButton } from '../answer/DecisionAnswerButton';
import { TaskCardContent, TaskCardView } from './TaskCard';

const meta = {
  title: 'Task/Card/TaskCard',
  component: TaskCardView,
  args: {
    task: makeTask({
      id: 42,
      title: 'Review the component split',
      taskStatus: 'doing',
      agentStatus: 'running',
    }),
    selected: false,
    onSelect: fn(),
  },
  render: (args) => <TaskCardView {...args} />,
} satisfies Meta<typeof TaskCardView>;
export default meta;
type Story = StoryObj<typeof meta>;

/** A card as the board's Summary gives it: no body, no condition text, no history. */
const summaryCard: TaskSummary = {
  id: 47,
  title: 'Card from the Summary',
  assignee: 'ai',
  taskStatus: 'doing',
  taskStatusChangedAt: '2026-10-01T09:00:00Z',
  position: 1,
  agentStatus: 'running',
  agentStatusChangedAt: '2026-10-01T09:00:00Z',
  pendingReason: null,
  pendingRequestId: null,
  pendingChoices: [],
  epic: null,
  updatedAt: '2026-10-01T09:30:00Z',
  isDraft: false,
  acceptance: { done: 2, total: 4 },
  acceptanceError: false,
};

export const Default: Story = {};
export const Idle: Story = {
  args: { task: makeTask({ id: 46, taskStatus: 'doing', agentStatus: 'idle' }) },
  play: async ({ canvasElement }) =>
    expect(within(canvasElement).getByText('Idle')).toBeInTheDocument(),
};
export const Selected: Story = {
  args: { selected: true },
  play: async ({ canvasElement }) =>
    expect(within(canvasElement).getByRole('button')).toHaveAttribute('aria-current', 'true'),
};
export const PartialAcceptance: Story = {
  args: {
    task: makeTask({
      id: 45,
      title: 'Prepare release',
      taskStatus: 'doing',
      acceptance: [
        { id: 'a1', text: 'Build passes', done: true },
        { id: 'a2', text: 'Docs are updated', done: true },
        { id: 'a3', text: 'Release notes are ready', done: true },
        { id: 'a4', text: 'Review is complete', done: false },
        { id: 'a5', text: 'Artifact is verified', done: false },
      ],
    }),
  },
  play: async ({ canvasElement }) =>
    expect(within(canvasElement).getByText('3/5')).toBeInTheDocument(),
};
export const FromSummary: Story = {
  args: { task: summaryCard },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Card from the Summary')).toBeInTheDocument();
    await expect(canvas.getByText('2/4')).toBeInTheDocument();
  },
};
export const Draft: Story = { args: { task: makeTask({ id: 43, isDraft: true }) } };
export const PendingWithEpic: Story = {
  args: {
    task: makeTask({
      id: 44,
      agentStatus: 'pending',
      pendingReason: 'Waiting for a decision.',
      epic: makeEpic(),
    }),
    renderEpic: (epic) => (
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        #{epic.id}
      </button>
    ),
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

/** A card with a decision request: the button replaces the question, as the board's TaskCard draws it. */
const answerCard = (continuing: boolean): Story['args'] => ({
  task: makeTask({
    id: 11,
    title: 'API refactor',
    agentStatus: 'pending',
    pendingReason: 'How much compatibility should v2 keep?',
    pendingRequestId: 'request-11',
    pendingChoices: [
      { id: 'keep', label: 'Keep compatibility' },
      { id: 'break', label: 'Allow the breaking change' },
    ],
  }),
  showPendingReason: false,
  children: (
    <div className="card__answer">
      <DecisionAnswerButton taskId={11} continuing={continuing} onClick={fn()} />
    </div>
  ),
});
export const PendingWithAnswer: Story = {
  args: answerCard(false),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: 'Answer the question' })).toBeInTheDocument();
    await expect(canvas.queryByText('How much compatibility should v2 keep?')).toBeNull();
    const button = canvas.getByRole('button', { name: 'Answer the question' });
    await expect(button.getBoundingClientRect().height).toBe(34);
  },
};
export const PendingSelected: Story = {
  args: { ...answerCard(false), selected: true },
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole('button', { name: 'Answer the question' });
    const item = button.closest<HTMLElement>('.card__item');
    const card = item?.querySelector<HTMLElement>('.card');
    if (!item || !card) throw new Error('The card frame is missing.');
    const accent = getComputedStyle(button).backgroundColor;
    // The selected frame surrounds the answer button, not only the card above it.
    await expect(getComputedStyle(item).borderTopColor).toBe(accent);
    await expect(getComputedStyle(item).borderBottomColor).toBe(accent);
    await expect(getComputedStyle(card).boxShadow).toBe('none');
  },
};
export const PendingContinuing: Story = {
  args: answerCard(true),
  play: async ({ canvasElement }) =>
    expect(
      within(canvasElement).getByRole('button', { name: 'Continue answering' }),
    ).toBeInTheDocument(),
};

const contentMeta = {
  title: 'Task/Card/TaskCardContent',
  component: TaskCardContent,
  args: { task: makeTask({ id: 42, title: 'Review the component split' }) },
} satisfies Meta<typeof TaskCardContent>;
export const Content: StoryObj<typeof contentMeta> = {
  render: (args) => <TaskCardContent {...args} />,
};
