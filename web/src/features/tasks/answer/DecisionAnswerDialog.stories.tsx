import type { Meta, StoryObj } from '@storybook/react-vite';
import { useTranslation } from 'react-i18next';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { modalDocsParameters } from '../../../../.storybook/support/modal-docs';
import { DecisionAnswerDialog } from './DecisionAnswerDialog';
import { resolveSampleAttachment } from './decisionAnswerSamples';
import type { AnswersWriter } from './model/qa';
import { SAMPLE_PROJECT, type SampleFlowInput, useSampleQuestions } from './questionSamples';
import { type AnswerStart, useAnswerFlow } from './useAnswerFlow';

interface HarnessProps {
  input: SampleFlowInput;
  start: AnswerStart;
  write: AnswersWriter;
  onClose: () => void;
}

/** The dialog running through the five sample questions, with the page's book behind it. */
function Harness({ input, start, write, onClose }: HarnessProps) {
  const { i18n } = useTranslation();
  const sample = useSampleQuestions(i18n.language, input);
  const { goTo, ...flow } = useAnswerFlow({
    projectId: SAMPLE_PROJECT,
    questions: sample.questions,
    tasks: sample.cards,
    book: sample.book,
    start,
    read: sample.read,
    write,
    attachmentUrl: (_taskId, id) => resolveSampleAttachment(id),
    onSent: onClose,
  });
  return <DecisionAnswerDialog {...flow} onStep={goTo} onClose={onClose} />;
}

const STEP_TWO: AnswerStart = { kind: 'question', questionId: 'Q-2' };

const meta = {
  title: 'Task/Answer/DecisionAnswerDialog',
  component: Harness,
  args: {
    input: { held: 1 },
    start: STEP_TWO,
    write: fn(async () => {}),
    onClose: fn(),
  },
  parameters: { ...modalDocsParameters, layout: 'fullscreen' },
} satisfies Meta<typeof Harness>;

export default meta;
type Story = StoryObj<typeof meta>;

const page = () => within(document.body);

/** The second of five questions: the first is answered, and the footer goes back or on. */
export const StepTwo: Story = {
  play: async () => {
    await expect(await page().findByRole('dialog', { name: /API refactor/ })).toBeInTheDocument();
    await expect(page().getByText('2 / 5')).toBeInTheDocument();
    await expect(await page().findByRole('table')).toBeInTheDocument();
    const progress = page().getByRole('navigation', { name: 'Answering progress' });
    await expect(within(progress).getAllByRole('button')).toHaveLength(6);
    await expect(
      within(progress).getByRole('button', { name: /How to handle the breaking change/ }),
    ).toHaveAttribute('aria-current', 'step');
    await expect(page().getByText('1 answered')).toBeInTheDocument();
    await expect(page().getByRole('button', { name: 'Previous' })).toBeEnabled();
    await expect(page().queryByRole('button', { name: 'Cancel' })).toBeNull();
  },
};

/** Choosing an option holds it; Next goes on, Previous comes back to the answer kept. */
export const AnswerAndMove: Story = {
  play: async () => {
    await userEvent.click(await page().findByRole('radio', { name: /Keep compatibility/ }));
    await expect(page().getByText('2 answered')).toBeInTheDocument();
    await userEvent.click(page().getByRole('button', { name: 'Next' }));
    await expect(await page().findByText('3 / 5')).toBeInTheDocument();
    await userEvent.click(page().getByRole('button', { name: 'Previous' }));
    await expect(await page().findByRole('radio', { name: /Keep compatibility/ })).toBeChecked();
  },
};

/** Every question answered: the review lists them, and one button sends them all. */
export const Review: Story = {
  args: { input: { held: 5 }, start: { kind: 'review' } },
  play: async ({ args }) => {
    await expect(
      await page().findByRole('dialog', { name: /Review your answers/ }),
    ).toBeInTheDocument();
    await expect(page().getByText('All 5 answered')).toBeInTheDocument();
    await expect(page().getAllByRole('button', { name: /^Change:/ })).toHaveLength(5);
    await expect(page().getByText('5 answered')).toBeInTheDocument();
    await userEvent.click(page().getByRole('button', { name: 'Send all' }));
    await waitFor(() => expect(args.write).toHaveBeenCalledTimes(1));
    await expect((args.write as ReturnType<typeof fn>).mock.calls[0]?.[1]).toHaveLength(5);
    await waitFor(() => expect(args.onClose).toHaveBeenCalledTimes(1));
  },
};

/** Some questions have no answer yet: the answered ones can still be sent. */
export const ReviewSome: Story = {
  args: { input: { held: 3 }, start: { kind: 'review' } },
  play: async () => {
    await expect(await page().findByText('3 of 5 answered')).toBeInTheDocument();
    await expect(page().getAllByRole('button', { name: /^Answer:/ })).toHaveLength(2);
    await expect(page().getByRole('button', { name: 'Send all' })).toBeEnabled();
  },
};

/** One question was answered elsewhere: its answer is marked and is left out of the send. */
export const ReviewClosed: Story = {
  args: {
    input: { held: 5, closed: [{ id: 'Q-4', reason: 'answered' }] },
    start: { kind: 'review' },
  },
  play: async ({ args }) => {
    await expect(
      await page().findByText(/This question was answered elsewhere/),
    ).toBeInTheDocument();
    await expect(page().getByText('4 answered')).toBeInTheDocument();
    await userEvent.click(page().getByRole('button', { name: /^Discard:/ }));
    await expect(page().queryByText(/This question was answered elsewhere/)).toBeNull();
    await userEvent.click(page().getByRole('button', { name: 'Send all' }));
    await waitFor(() => expect(args.write).toHaveBeenCalledTimes(1));
    await expect((args.write as ReturnType<typeof fn>).mock.calls[0]?.[1]).toHaveLength(4);
  },
};

/** The send failed: the answers stay, and the failure offers to send again. */
export const SendFailed: Story = {
  args: {
    input: { held: 5 },
    start: { kind: 'review' },
    write: fn(async () => {
      throw new Error('offline');
    }),
  },
  play: async ({ args }) => {
    await userEvent.click(await page().findByRole('button', { name: 'Send all' }));
    await expect(await page().findByRole('alert')).toHaveTextContent('Could not save');
    await expect(page().getAllByRole('button', { name: /^Change:/ })).toHaveLength(5);
    await expect(args.onClose).not.toHaveBeenCalled();
  },
};

/** The step in Japanese, at the mock's width. */
export const Japanese: Story = {
  globals: { locale: 'ja' },
  play: async () => {
    await expect(
      await page().findByRole('dialog', { name: /APIリファクタリング/ }),
    ).toBeInTheDocument();
    await expect(page().getByRole('button', { name: '次へ' })).toBeEnabled();
  },
};

/** The review in Japanese. */
export const JapaneseReview: Story = {
  args: { input: { held: 5 }, start: { kind: 'review' } },
  globals: { locale: 'ja' },
  play: async () => {
    await expect(await page().findByRole('button', { name: 'まとめて送る' })).toBeEnabled();
  },
};

/** Dark mode takes only the existing tokens. */
export const Dark: Story = {
  globals: { locale: 'ja', mode: 'dark' },
  play: async () => {
    await expect(await page().findByRole('dialog')).toBeInTheDocument();
  },
};

/** The review in dark mode. */
export const DarkReview: Story = {
  args: { input: { held: 5 }, start: { kind: 'review' } },
  globals: { locale: 'ja', mode: 'dark' },
  play: async () => {
    await expect(await page().findByRole('button', { name: 'まとめて送る' })).toBeEnabled();
  },
};
