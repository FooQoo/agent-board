import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { modalDocsParameters } from '../../../../.storybook/support/modal-docs';
import { DecisionAnswerSheet } from './DecisionAnswerSheet';
import {
  resolveSampleAttachment,
  sampleFor,
  useSampleAnswer,
  type SampleAnswerInput,
} from './decisionAnswerSamples';

interface HarnessProps {
  initial: SampleAnswerInput;
  onSubmit: () => void;
  onRetry: () => void;
  onOpenChange: (open: boolean) => void;
}

/** The sheet with an answer that can be typed into, as the monitor would hold it. */
function Harness({ initial, onSubmit, onRetry, onOpenChange }: HarnessProps) {
  const { i18n } = useTranslation();
  const sample = sampleFor(i18n.language);
  const answer = useSampleAnswer(initial, sample);
  const [open, setOpen] = useState(true);
  return (
    <DecisionAnswerSheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        onOpenChange(next);
      }}
      identity="#11"
      title={sample.title}
      question={sample.sheetQuestion}
      choices={sample.choices}
      resolveAttachment={resolveSampleAttachment}
      onSubmit={onSubmit}
      onRetry={onRetry}
      {...answer}
    />
  );
}

const meta = {
  title: 'Task/Answer/DecisionAnswerSheet',
  component: Harness,
  args: { initial: {}, onSubmit: fn(), onRetry: fn(), onOpenChange: fn() },
  // The sheet is the monitor's, so the monitor stylesheet is loaded for these Stories.
  parameters: { ...modalDocsParameters, storyFrame: 'monitor', layout: 'fullscreen' },
  globals: { width: 'phone-390' },
} satisfies Meta<typeof Harness>;

export default meta;
type Story = StoryObj<typeof meta>;

const page = () => within(document.body);
const NOTE_EN = 'I want to keep it until v3 ships. The CLI fix can wait until next week.';

/** The question, then the answer; Send is pinned below and waits for an input. */
export const Normal: Story = {
  args: { initial: { choiceId: 'keep' } },
  play: async ({ args }) => {
    await expect(await page().findByRole('dialog', { name: 'API refactor' })).toBeInTheDocument();
    await expect(page().getByText('#11')).toBeInTheDocument();
    await expect(await page().findByRole('table')).toBeInTheDocument();
    await waitFor(() => expect(page().getAllByRole('radio')[0]).toHaveFocus());
    await expect(page().getByRole('radio', { name: /Keep compatibility/ })).toBeChecked();
    await expect(page().getByRole('button', { name: 'Send' })).toBeEnabled();
    await userEvent.click(page().getByRole('radio', { name: /Allow the breaking change/ }));
    await expect(page().getByRole('radio', { name: /Allow the breaking change/ })).toBeChecked();
    await userEvent.click(page().getByRole('button', { name: 'Send' }));
    await expect(args.onSubmit).toHaveBeenCalledTimes(1);
  },
};

/** The input is kept and the send failed: a band with Retry sits above Send. */
export const InputAndFailed: Story = {
  args: {
    initial: { choiceId: 'keep', note: true, phase: 'failed' },
  },
  play: async ({ args }) => {
    // The answer field is below the question: scroll to it once the picture has its size.
    const picture = await page().findByRole('img');
    await waitFor(() => expect((picture as HTMLImageElement).complete).toBe(true));
    const dialog = page().getByRole('dialog');
    const panel = dialog.querySelector<HTMLElement>('.decision-panel');
    const answer = dialog.querySelector<HTMLElement>('.decision-panel__answer');
    if (panel !== null && answer !== null) {
      panel.scrollTop = answer.getBoundingClientRect().top - panel.getBoundingClientRect().top;
    }
    await expect(await page().findByRole('alert')).toHaveTextContent('Could not save. Try again.');
    await expect(page().getByRole('textbox', { name: 'Note' })).toHaveValue(NOTE_EN);
    await userEvent.click(page().getByRole('button', { name: 'Retry' }));
    await expect(args.onRetry).toHaveBeenCalledTimes(1);
  },
};

/** Sending stops the input; the sheet does not close until it is done. */
export const Sending: Story = {
  args: { initial: { choiceId: 'keep', phase: 'sending' } },
  play: async ({ args }) => {
    await expect(await page().findByRole('button', { name: 'Sending…' })).toBeDisabled();
    await expect(page().getByRole('textbox', { name: 'Note' })).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    await expect(args.onOpenChange).not.toHaveBeenCalled();
  },
};

/** The question changed while the sheet was open. */
export const Changed: Story = {
  args: { initial: { note: true, notice: 'changed' } },
  play: async () => {
    await expect(
      await page().findByText('The question has changed. Review it and answer again.'),
    ).toBeVisible();
    await expect(page().getByRole('radio', { name: /Keep compatibility/ })).not.toBeChecked();
  },
};

/** The question was withdrawn: it can be read, and the send is gone. */
export const Withdrawn: Story = {
  args: { initial: { note: true, notice: 'withdrawn' } },
  play: async () => {
    await expect(
      await page().findByText('This question was withdrawn. You can no longer answer it.'),
    ).toBeVisible();
    await expect(page().queryByRole('button', { name: 'Send' })).toBeNull();
  },
};

/** Dark mode takes only the existing tokens. */
export const Dark: Story = {
  args: { initial: { choiceId: 'keep' } },
  globals: { mode: 'dark', width: 'phone-390' },
  play: async () => {
    await expect(await page().findByRole('dialog')).toBeVisible();
    await expect(page().getByRole('button', { name: 'Send' })).toBeEnabled();
  },
};
