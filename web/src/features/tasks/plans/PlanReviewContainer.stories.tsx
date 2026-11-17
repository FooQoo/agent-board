import type { Meta, StoryObj } from '@storybook/react-vite';
import { useTranslation } from 'react-i18next';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { detailData } from '../../../../.storybook/support/detailData';
import { modalDocsParameters } from '../../../../.storybook/support/modal-docs';
import { WriteError } from '../../../shared/api/writeErrors';
import { PlanReviewContainer } from './PlanReviewContainer';
import { newEpicPlan, sampleEpic, SAMPLE_PROJECT, singlePlan } from './planSamples';

interface HarnessProps {
  mode: 'ready' | 'blocked' | 'refused' | 'single';
  start: () => Promise<void>;
  onClose: () => void;
  onChanged: () => void;
  onOpenQuestion: (questionId: string) => void;
  /** Read by the detail data decorator: the epic whose document holds the goal. */
  epic: ReturnType<typeof sampleEpic>;
}

/** The review wired as the board wires it: the goal is read from the epic's document. */
function Harness({ mode, start, onClose, onChanged, onOpenQuestion }: HarnessProps) {
  const { i18n } = useTranslation();
  const plan =
    mode === 'single' ? singlePlan(i18n.language) : newEpicPlan(i18n.language, mode !== 'blocked');
  return (
    <PlanReviewContainer
      projectId={SAMPLE_PROJECT}
      plans={[plan]}
      approval={plan.id}
      kind="dialog"
      start={start}
      onClose={onClose}
      onChanged={onChanged}
      onOpenQuestion={onOpenQuestion}
    />
  );
}

const meta = {
  title: 'Task/Plans/PlanReviewContainer',
  component: Harness,
  decorators: [detailData],
  args: {
    mode: 'ready',
    start: fn(async () => {}),
    onClose: fn(),
    onChanged: fn(),
    onOpenQuestion: fn(),
    epic: sampleEpic('ja'),
  },
  parameters: { ...modalDocsParameters, layout: 'fullscreen' },
  globals: { locale: 'ja' },
} satisfies Meta<typeof Harness>;

export default meta;
type Story = StoryObj<typeof meta>;

const page = () => within(document.body);

/** The goal comes from the epic's document; starting calls the route, then closes and reports. */
export const Start: Story = {
  play: async ({ args }) => {
    await waitFor(() => expect(page().queryAllByText(/メールのリンク/).length).toBeGreaterThan(0));
    await userEvent.click(page().getByRole('button', { name: 'この計画で始める' }));
    await waitFor(() =>
      expect(args.start).toHaveBeenCalledWith(
        SAMPLE_PROJECT,
        expect.objectContaining({ id: 'LOGIN-1' }),
      ),
    );
    await waitFor(() => expect(args.onClose).toHaveBeenCalledOnce());
    await expect(args.onChanged).toHaveBeenCalledOnce();
  },
};

/** An unanswered question blocks the start; its button hands the question to the caller. */
export const BlockedByQuestion: Story = {
  args: { mode: 'blocked' },
  play: async ({ args }) => {
    await expect(await page().findByRole('button', { name: 'この計画で始める' })).toBeDisabled();
    await userEvent.click(page().getByRole('button', { name: '質問に答える' }));
    await expect(args.onOpenQuestion).toHaveBeenCalledWith('Q-12');
    await expect(args.start).not.toHaveBeenCalled();
  },
};

/** The server refuses with `start_blocked_by_questions`: the review stays open and names the question. */
export const RefusedByNewQuestion: Story = {
  args: {
    mode: 'refused',
    start: fn(async () => {
      throw new WriteError('Q-14 has no reply.', 409, 'start_blocked_by_questions');
    }),
  },
  play: async ({ args }) => {
    await userEvent.click(await page().findByRole('button', { name: 'この計画で始める' }));
    await expect(await page().findByRole('note')).toHaveTextContent('Q-14');
    await expect(args.onClose).not.toHaveBeenCalled();
    await expect(args.onChanged).toHaveBeenCalledOnce();
  },
};

/** Any other failure keeps the review open with a plain message. */
export const FailedStart: Story = {
  args: {
    start: fn(async () => {
      throw new WriteError('Boom', 500, 'internal');
    }),
  },
  play: async () => {
    await userEvent.click(await page().findByRole('button', { name: 'この計画で始める' }));
    await expect(await page().findByRole('note')).toHaveTextContent('計画を開始できませんでした');
  },
};

/** A single task starts by its own route. */
export const SingleTask: Story = {
  args: { mode: 'single' },
  play: async ({ args }) => {
    await userEvent.click(await page().findByRole('button', { name: 'この計画で始める' }));
    await waitFor(() =>
      expect(args.start).toHaveBeenCalledWith(
        SAMPLE_PROJECT,
        expect.objectContaining({ id: '#31' }),
      ),
    );
  },
};
