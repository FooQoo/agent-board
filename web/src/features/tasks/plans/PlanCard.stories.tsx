import type { Meta, StoryObj } from '@storybook/react-vite';
import { useTranslation } from 'react-i18next';
import { expect, fn, userEvent, within } from 'storybook/test';
import { PlanCardFor } from './PlanCard';
import { addedPlan, newEpicPlan, singlePlan } from './planSamples';

type Kind = 'new' | 'newBlocked' | 'added' | 'single' | 'singleBlocked';

/** One plan card in a lane-wide column, as it sits at the top of Todo. */
function Harness({ kind, onReview }: { kind: Kind; onReview: () => void }) {
  const { i18n } = useTranslation();
  const language = i18n.language;
  const plan =
    kind === 'new'
      ? newEpicPlan(language, true)
      : kind === 'newBlocked'
        ? newEpicPlan(language)
        : kind === 'added'
          ? addedPlan(language)
          : singlePlan(language, kind === 'singleBlocked');
  return (
    <div className="lane__cards" style={{ width: 320, padding: 16 }}>
      <PlanCardFor plan={plan} onReview={onReview} />
    </div>
  );
}

const meta = {
  title: 'Task/Plans/PlanCard',
  component: Harness,
  args: { kind: 'new', onReview: fn() },
  globals: { locale: 'ja' },
} satisfies Meta<typeof Harness>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A new epic: the card names the epic and the number of tasks, and opens the review. */
export const NewEpic: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('提案中の計画')).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: '見て開始する' }));
    await expect(args.onReview).toHaveBeenCalledOnce();
  },
};

/** The plan waits for an answer: the card shows how many questions are open. */
export const NewEpicWithOpenQuestion: Story = {
  args: { kind: 'newBlocked' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('未回答の質問 1')).toBeVisible();
  },
};

/** Tasks added to an epic that is already running. */
export const AddedToEpic: Story = {
  args: { kind: 'added' },
  globals: { locale: 'en' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('2 tasks added to SEARCH-2')).toBeVisible();
  },
};

/** A single AI-draft task: marked as a draft, with a start button. */
export const SingleDraftTask: Story = {
  args: { kind: 'single' },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('下書き(AI)')).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: '開始する' }));
    await expect(args.onReview).toHaveBeenCalledOnce();
  },
};

/** A single draft task behind an unanswered question: the button is disabled and says why. */
export const SingleDraftTaskBlocked: Story = {
  args: { kind: 'singleBlocked' },
  globals: { locale: 'en' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: 'Start' })).toBeDisabled();
    await expect(canvas.getByText('Cannot start: a question is unanswered')).toBeVisible();
  },
};
