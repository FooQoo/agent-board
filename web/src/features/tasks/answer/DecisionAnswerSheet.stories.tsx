import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { modalDocsParameters } from '../../../../.storybook/support/modal-docs';
import { DecisionAnswerSheet } from './DecisionAnswerSheet';
import { resolveSampleAttachment } from './decisionAnswerSamples';
import type { AnswersWriter } from './model/qa';
import { SAMPLE_PROJECT, type SampleFlowInput, useSampleQuestions } from './questionSamples';
import { type AnswerStart, answerStart } from './answerStart';
import { useAnswerFlow } from './useAnswerFlow';

interface HarnessProps {
  input: SampleFlowInput;
  start: AnswerStart;
  write: AnswersWriter;
  onOpenChange: (open: boolean) => void;
}

/** The sheet running through the five sample questions, as the monitor holds them. */
function Harness({ input, start, write, onOpenChange }: HarnessProps) {
  const { i18n } = useTranslation();
  const sample = useSampleQuestions(i18n.language, { ...input, sheet: true });
  const [open, setOpen] = useState(true);
  const change = (next: boolean) => {
    setOpen(next);
    onOpenChange(next);
  };
  const { goTo: _goTo, ...flow } = useAnswerFlow({
    projectId: SAMPLE_PROJECT,
    questions: sample.questions,
    tasks: sample.cards,
    book: sample.book,
    start,
    read: sample.read,
    write,
    attachmentUrl: (_taskId, id) => resolveSampleAttachment(id),
    onSent: () => change(false),
  });
  return <DecisionAnswerSheet {...flow} open={open} onOpenChange={change} />;
}

const meta = {
  title: 'Task/Answer/DecisionAnswerSheet',
  component: Harness,
  args: {
    input: { held: 1 },
    start: answerStart.resume(),
    write: fn(async () => {}),
    onOpenChange: fn(),
  },
  // The sheet is the monitor's, so the monitor stylesheet is loaded for these Stories.
  parameters: { ...modalDocsParameters, storyFrame: 'monitor', layout: 'fullscreen' },
  globals: { width: 'phone-375' },
} satisfies Meta<typeof Harness>;

export default meta;
type Story = StoryObj<typeof meta>;

const page = () => within(document.body);

/** The second of five: the position and the card on top, dots below, two equal buttons at the foot. */
export const Step: Story = {
  play: async () => {
    await expect(await page().findByRole('dialog', { name: 'API refactor' })).toBeInTheDocument();
    await expect(page().getByText('2 / 5')).toBeInTheDocument();
    await expect(page().getByText('#11')).toBeInTheDocument();
    await expect(page().getByText('1 answered, not sent')).toBeInTheDocument();
    const prev = page().getByRole('button', { name: 'Previous' });
    const next = page().getByRole('button', { name: 'Next' });
    await waitFor(() =>
      expect(Math.round(prev.getBoundingClientRect().width)).toBe(
        Math.round(next.getBoundingClientRect().width),
      ),
    );
    await expect(Math.round(next.getBoundingClientRect().height)).toBe(44);
    await userEvent.click(await page().findByRole('radio', { name: /Keep compatibility/ }));
    await expect(page().getByText('2 answered, not sent')).toBeInTheDocument();
  },
};

/** A plan question for three cards: the title counts the cards rather than naming the first. */
export const SeveralTasks: Story = {
  args: { start: answerStart.question('Q-5') },
  play: async () => {
    await expect(await page().findByRole('dialog', { name: /3 tasks/ })).toBeInTheDocument();
    await expect(page().getByText('1 / 1')).toBeInTheDocument();
    await expect(page().getByText('#14 #15 #16')).toBeInTheDocument();
  },
};

/** Opened from a card: only its two questions, and the last one sends them, with no review. */
export const FromCard: Story = {
  args: { input: { held: 1 }, start: answerStart.task(14) },
  play: async ({ args }) => {
    await expect(await page().findByText('1 / 2')).toBeInTheDocument();
    await expect(page().queryByText('Review and send')).toBeNull();
    await userEvent.click((await page().findAllByRole('radio'))[0] as HTMLElement);
    await userEvent.click(page().getByRole('button', { name: 'Next' }));
    await expect(await page().findByText('2 / 2')).toBeInTheDocument();
    const send = page().getByRole('button', { name: /^Send$/ });
    // The first answer is already held, so the card can be sent from here.
    await expect(send).toBeEnabled();
    await userEvent.click((await page().findAllByRole('radio'))[0] as HTMLElement);
    await userEvent.click(send);
    await waitFor(() => expect(args.write).toHaveBeenCalledTimes(1));
    // The answer held for a question of another card stays out of the send.
    await expect((args.write as ReturnType<typeof fn>).mock.calls[0]?.[1]).toHaveLength(2);
  },
};

/** Opened from the band: only that question, and Send sends it at once, with no review. */
export const FromBand: Story = {
  args: { input: { held: 0 }, start: answerStart.question('Q-2') },
  play: async ({ args }) => {
    await expect(await page().findByText('1 / 1')).toBeInTheDocument();
    await expect(page().queryByText('Review and send')).toBeNull();
    await expect(page().queryByRole('button', { name: 'Next' })).toBeNull();
    await userEvent.click(await page().findByRole('radio', { name: /Keep compatibility/ }));
    await userEvent.click(page().getByRole('button', { name: /^Send$/ }));
    await waitFor(() => expect(args.write).toHaveBeenCalledTimes(1));
    await expect((args.write as ReturnType<typeof fn>).mock.calls[0]?.[1]).toHaveLength(1);
    await waitFor(() => expect(args.onOpenChange).toHaveBeenCalledWith(false));
  },
};

/** Every question answered: the review, then Send all. */
export const Review: Story = {
  args: { input: { held: 5 }, start: answerStart.review() },
  play: async ({ args }) => {
    await expect(
      await page().findByRole('dialog', { name: 'Review your answers' }),
    ).toBeInTheDocument();
    await expect(page().getByText('All 5 answered')).toBeInTheDocument();
    await expect(page().getAllByRole('button', { name: /^Change:/ })).toHaveLength(5);
    await userEvent.click(page().getByRole('button', { name: 'Send all' }));
    await waitFor(() => expect(args.write).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(args.onOpenChange).toHaveBeenCalledWith(false));
  },
};

/** While sending, the input stops and the sheet does not close. */
export const Sending: Story = {
  args: {
    input: { held: 5 },
    start: answerStart.review(),
    write: fn(() => new Promise<void>(() => {})),
  },
  play: async ({ args }) => {
    await userEvent.click(await page().findByRole('button', { name: 'Send all' }));
    await expect(await page().findByRole('button', { name: 'Sending…' })).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    await expect(args.onOpenChange).not.toHaveBeenCalled();
  },
};

/** The send failed: a band with the reason, and the answers kept. */
export const SendFailed: Story = {
  args: {
    input: { held: 5 },
    start: answerStart.review(),
    write: fn(async () => {
      throw new Error('offline');
    }),
  },
  play: async () => {
    await userEvent.click(await page().findByRole('button', { name: 'Send all' }));
    await expect(await page().findByRole('alert')).toHaveTextContent('Could not save');
    await expect(page().getByRole('button', { name: 'Send all' })).toBeEnabled();
  },
};

/** One question was withdrawn while the sheet was open: it can be read, not answered. */
export const Withdrawn: Story = {
  args: { input: { held: 1, closed: [{ id: 'Q-2', reason: 'withdrawn' }] } },
  play: async () => {
    await expect(
      await page().findByText('This question was withdrawn. You can no longer answer it.'),
    ).toBeVisible();
    await expect(page().getByRole('textbox', { name: 'Note' })).toBeDisabled();
  },
};

/** The step in Japanese, as the mock shows it. */
export const Japanese: Story = {
  globals: { locale: 'ja', width: 'phone-375' },
  play: async () => {
    await expect(await page().findByRole('button', { name: '次へ' })).toBeEnabled();
  },
};

/** The review in Japanese. */
export const JapaneseReview: Story = {
  args: { input: { held: 5 }, start: answerStart.review() },
  globals: { locale: 'ja', width: 'phone-375' },
  play: async () => {
    await expect(await page().findByRole('button', { name: 'まとめて送る' })).toBeEnabled();
  },
};

/** Dark mode takes only the existing tokens. */
export const Dark: Story = {
  globals: { locale: 'ja', mode: 'dark', width: 'phone-375' },
  play: async () => {
    await expect(await page().findByRole('dialog')).toBeVisible();
  },
};

/** The review in dark mode. */
export const DarkReview: Story = {
  args: { input: { held: 5 }, start: answerStart.review() },
  globals: { locale: 'ja', mode: 'dark', width: 'phone-375' },
  play: async () => {
    await expect(await page().findByRole('button', { name: 'まとめて送る' })).toBeEnabled();
  },
};
