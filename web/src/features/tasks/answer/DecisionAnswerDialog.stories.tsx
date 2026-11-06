import type { Meta, StoryObj } from '@storybook/react-vite';
import { useTranslation } from 'react-i18next';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { modalDocsParameters } from '../../../../.storybook/support/modal-docs';
import { DecisionAnswerDialog } from './DecisionAnswerDialog';
import {
  resolveSampleAttachment,
  sampleFor,
  useSampleAnswer,
  type SampleAnswerInput,
} from './decisionAnswerSamples';

interface HarnessProps {
  initial: SampleAnswerInput;
  /** The question with extra sections, so the left column has to scroll. */
  long?: boolean;
  onClose: () => void;
  onSubmit: () => void;
  onRetry: () => void;
}

/** The dialog with an answer that can be typed into, as a screen would hold it. */
function Harness({ initial, long = false, onClose, onSubmit, onRetry }: HarnessProps) {
  const { i18n } = useTranslation();
  const sample = sampleFor(i18n.language);
  const answer = useSampleAnswer(initial, sample);
  return (
    <DecisionAnswerDialog
      taskId={11}
      title={sample.title}
      question={long ? sample.longQuestion : sample.question}
      choices={sample.choices}
      resolveAttachment={resolveSampleAttachment}
      onClose={onClose}
      onSubmit={onSubmit}
      onRetry={onRetry}
      {...answer}
    />
  );
}

const meta = {
  title: 'Task/Answer/DecisionAnswerDialog',
  component: Harness,
  args: { initial: {}, onClose: fn(), onSubmit: fn(), onRetry: fn() },
  parameters: { ...modalDocsParameters, layout: 'fullscreen' },
} satisfies Meta<typeof Harness>;

export default meta;
type Story = StoryObj<typeof meta>;

const page = () => within(document.body);
/** The footer button; the header has an X with the same name. */
const closeButton = (name: string) => page().getAllByRole('button', { name }).at(-1) as HTMLElement;
const NOTE_EN = 'I want to keep it until v3 ships. The CLI fix can wait until next week.';

/** Nothing is chosen yet: the first option has the focus, and Send waits for an input. */
export const Normal: Story = {
  play: async ({ args }) => {
    await expect(await page().findByRole('dialog', { name: /API refactor/ })).toBeInTheDocument();
    await expect(await page().findByRole('table')).toBeInTheDocument();
    await expect(await page().findByRole('img', { name: 'The board' })).toHaveAttribute(
      'src',
      '/sample-question.png',
    );
    await waitFor(() => expect(page().getAllByRole('radio')[0]).toHaveFocus());
    await expect(page().getByRole('button', { name: 'Send' })).toBeDisabled();
    await expect(page().queryByRole('button', { name: 'Clear' })).toBeNull();
    await userEvent.click(page().getByRole('radio', { name: 'Keep compatibility (recommended)' }));
    await expect(page().getByRole('button', { name: 'Send' })).toBeEnabled();
    await userEvent.click(page().getByRole('button', { name: 'Send' }));
    await expect(args.onSubmit).toHaveBeenCalledTimes(1);
    await userEvent.click(page().getByRole('button', { name: 'Clear' }));
    await expect(page().getByRole('button', { name: 'Send' })).toBeDisabled();
    await expect(page().queryByRole('button', { name: 'Clear' })).toBeNull();
    await userEvent.click(closeButton('Close'));
    await expect(args.onClose).toHaveBeenCalledTimes(1);
  },
};

/** An option and a note: Send is on, and the clear link shows beside the guide. */
export const Filled: Story = {
  args: { initial: { choiceId: 'keep', note: true } },
  play: async () => {
    await expect(await page().findByRole('radio', { name: /Keep compatibility/ })).toBeChecked();
    await expect(page().getByRole('textbox', { name: 'Note' })).toHaveValue(NOTE_EN);
    await expect(page().getByRole('button', { name: 'Send' })).toBeEnabled();
    await expect(page().getByRole('button', { name: 'Clear' })).toBeInTheDocument();
  },
};

/** A note alone is an answer; there is nothing to choose. */
export const NoteOnly: Story = {
  args: { initial: { text: 'Neither: ask again next week.' } },
  play: async () => {
    await expect(await page().findByRole('button', { name: 'Send' })).toBeEnabled();
    await userEvent.type(page().getByRole('textbox', { name: 'Note' }), ' Thanks.');
    await expect(page().getByRole('textbox', { name: 'Note' })).toHaveValue(
      'Neither: ask again next week. Thanks.',
    );
  },
};

/** Sending stops the input and the close, and the button says so. */
export const Sending: Story = {
  args: { initial: { choiceId: 'keep', note: true, phase: 'sending' } },
  play: async () => {
    await expect(await page().findByRole('button', { name: 'Sending…' })).toBeDisabled();
    await expect(closeButton('Close')).toBeDisabled();
    await expect(page().getByRole('textbox', { name: 'Note' })).toBeDisabled();
    await expect(page().getByRole('radio', { name: /Keep compatibility/ })).toBeDisabled();
    await expect(page().queryByRole('button', { name: 'Clear' })).toBeNull();
  },
};

/** The send failed: the input stays, and a band above the footer offers Retry. */
export const Failed: Story = {
  args: {
    initial: { choiceId: 'keep', note: true, phase: 'failed' },
  },
  play: async ({ args }) => {
    await expect(await page().findByRole('alert')).toHaveTextContent('Could not save. Try again.');
    await expect(page().getByRole('textbox', { name: 'Note' })).toHaveValue(NOTE_EN);
    await userEvent.click(page().getByRole('button', { name: 'Retry' }));
    await expect(args.onRetry).toHaveBeenCalledTimes(1);
    await expect(page().getByRole('button', { name: 'Send' })).toBeEnabled();
  },
};

/** The question changed while the dialog was open: no option is chosen, and the note is kept. */
export const Changed: Story = {
  args: { initial: { note: true, notice: 'changed' } },
  play: async () => {
    await expect(
      page().getByText('The question has changed. Review it and answer again.'),
    ).toBeInTheDocument();
    await expect(page().getByRole('radio', { name: /Keep compatibility/ })).not.toBeChecked();
    await expect(page().getByRole('textbox', { name: 'Note' })).toHaveValue(NOTE_EN);
    await expect(page().getByRole('button', { name: 'Send' })).toBeEnabled();
  },
};

/** The question was withdrawn: it can still be read, nothing can be sent, and Close is left. */
export const Withdrawn: Story = {
  args: { initial: { note: true, notice: 'withdrawn' } },
  play: async () => {
    await expect(
      await page().findByText('This question was withdrawn. You can no longer answer it.'),
    ).toBeInTheDocument();
    await expect(page().queryByRole('button', { name: 'Send' })).toBeNull();
    await expect(closeButton('Close')).toBeEnabled();
    await expect(page().getByRole('textbox', { name: 'Note' })).toBeDisabled();
  },
};

/** The same screen in Japanese, as the design's final mock shows it. */
export const Japanese: Story = {
  args: { initial: { choiceId: 'keep', note: true } },
  globals: { locale: 'ja' },
  play: async () => {
    await expect(await page().findByRole('radio', { name: /互換性を維持する/ })).toBeChecked();
    await expect(page().getByRole('button', { name: '入力をクリア' })).toBeInTheDocument();
    await expect(closeButton('閉じる')).toBeEnabled();
  },
};

/** Dark mode takes only the existing tokens. */
export const Dark: Story = {
  args: { initial: { choiceId: 'keep', note: true } },
  globals: { mode: 'dark' },
  play: async () => {
    await expect(await page().findByRole('dialog')).toBeInTheDocument();
  },
};

/** A long question scrolls inside the left column; the answer on the right does not move. */
export const LongQuestion: Story = {
  args: { long: true, initial: { choiceId: 'keep' } },
  play: async () => {
    const dialog = await page().findByRole('dialog');
    const left = dialog.querySelector<HTMLElement>('.decision-panel__question');
    const right = dialog.querySelector<HTMLElement>('.decision-panel__answer');
    await waitFor(() => expect(left && left.scrollHeight > left.clientHeight).toBe(true));
    await expect(right && right.scrollHeight <= right.clientHeight).toBe(true);
    await expect(page().getByRole('textbox', { name: 'Note' })).toBeInTheDocument();
  },
};

/** Narrower than 900px the two columns stack, and the whole body scrolls. */
export const Narrow: Story = {
  decorators: [
    (Story) => (
      <>
        <style>{'.editor-dialog.decision-dialog { width: 720px; }'}</style>
        <Story />
      </>
    ),
  ],
  play: async () => {
    const dialog = await page().findByRole('dialog');
    const panel = dialog.querySelector<HTMLElement>('.decision-panel');
    const question = dialog.querySelector<HTMLElement>('.decision-panel__question');
    const answer = dialog.querySelector<HTMLElement>('.decision-panel__answer');
    await waitFor(() =>
      expect(getComputedStyle(panel as HTMLElement).flexDirection).toBe('column'),
    );
    await expect(
      (answer as HTMLElement).getBoundingClientRect().top >=
        (question as HTMLElement).getBoundingClientRect().bottom - 1,
    ).toBe(true);
  },
};
