import type { Meta, StoryObj } from '@storybook/react-vite';
import { useTranslation } from 'react-i18next';
import { expect, userEvent, within } from 'storybook/test';
import { DecisionAnswerPanel } from './DecisionAnswerPanel';
import {
  resolveSampleAttachment,
  sampleFor,
  useSampleAnswer,
  type SampleAnswerInput,
} from './decisionAnswerSamples';

interface HarnessProps {
  initial: SampleAnswerInput;
  /** Draw no options: the note alone is the answer. */
  withoutChoices?: boolean;
  question?: string | null;
}

/** The panel with an answer that can be typed into, in a column as wide as the sheet. */
function Harness({ initial, withoutChoices = false, question }: HarnessProps) {
  const { i18n } = useTranslation();
  const sample = sampleFor(i18n.language);
  const answer = useSampleAnswer(initial, sample);
  return (
    <div style={{ display: 'flex', width: 480, height: 760 }}>
      <DecisionAnswerPanel
        question={question === undefined ? sample.question : question}
        choices={withoutChoices ? [] : sample.choices}
        resolveAttachment={resolveSampleAttachment}
        {...answer}
      />
    </div>
  );
}

const meta = {
  title: 'Task/Answer/DecisionAnswerPanel',
  component: Harness,
  args: { initial: {} },
} satisfies Meta<typeof Harness>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The question is drawn as the task body is: heading, table, picture, code, text. */
export const Empty: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('table')).toBeInTheDocument();
    await expect(await canvas.findByRole('img', { name: 'The board' })).toHaveAttribute(
      'src',
      '/sample-question.png',
    );
    await expect(canvas.getByRole('radiogroup', { name: 'Your answer' })).toBeInTheDocument();
    await expect(canvas.getAllByRole('radio')).toHaveLength(3);
    await expect(canvas.getByRole('textbox', { name: 'Note' })).toHaveValue('');
    await expect(canvas.queryByRole('button', { name: 'Clear' })).toBeNull();
  },
};

/** Choosing, typing and clearing, as the parts send them to the form state. */
export const ChooseTypeClear: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('radio', { name: 'Allow the breaking change' }));
    await expect(canvas.getByRole('radio', { name: 'Allow the breaking change' })).toBeChecked();
    await userEvent.type(canvas.getByRole('textbox', { name: 'Note' }), 'After v3.');
    await userEvent.click(canvas.getByRole('button', { name: 'Clear' }));
    await expect(
      canvas.getByRole('radio', { name: 'Allow the breaking change' }),
    ).not.toBeChecked();
    await expect(canvas.getByRole('textbox', { name: 'Note' })).toHaveValue('');
  },
};

/** A question without options is answered with a note; no guide about options is shown. */
export const NoteOnly: Story = {
  args: { withoutChoices: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('textbox', { name: 'Note' })).toBeVisible();
    await expect(canvas.queryByRole('radio')).toBeNull();
    await expect(canvas.queryByText('Choose an option, or answer with a note alone.')).toBeNull();
  },
};

/** The note is over the limit: it is marked, and Send stays off. */
export const TooLong: Story = {
  args: { initial: { text: 'x'.repeat(2001), tooLong: true } },
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByRole('textbox', { name: 'Note' }),
    ).toHaveAttribute('aria-invalid', 'true');
  },
};

/** No question text: the answer is still there. */
export const WithoutQuestion: Story = {
  args: { question: null },
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByRole('textbox', { name: 'Note' })).toBeVisible();
  },
};
