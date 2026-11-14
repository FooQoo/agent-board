import type { Meta, StoryObj } from '@storybook/react-vite';
import { useTranslation } from 'react-i18next';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { modalDocsParameters } from '../../../../.storybook/support/modal-docs';
import { DecisionAnswerDialogContainer } from './DecisionAnswerDialogContainer';
import type { AnswersWriter } from './model/qa';
import { SAMPLE_PROJECT, useSampleQuestions } from './questionSamples';

interface HarnessProps {
  write: AnswersWriter;
  onSent: () => void;
  onClose: () => void;
}

/** The dialog wired as the board wires it, from the first question without an answer. */
function Harness({ write, onSent, onClose }: HarnessProps) {
  const { i18n } = useTranslation();
  const sample = useSampleQuestions(i18n.language, { held: 0 });
  return (
    <DecisionAnswerDialogContainer
      projectId={SAMPLE_PROJECT}
      questions={sample.questions}
      tasks={sample.cards}
      book={sample.book}
      start={{ kind: 'resume' }}
      read={sample.read}
      write={write}
      onSent={onSent}
      onClose={onClose}
    />
  );
}

const meta = {
  title: 'Task/Answer/DecisionAnswerDialogContainer',
  component: Harness,
  args: { write: fn(async () => {}), onSent: fn(), onClose: fn() },
  parameters: { ...modalDocsParameters, layout: 'fullscreen' },
} satisfies Meta<typeof Harness>;

export default meta;
type Story = StoryObj<typeof meta>;

const page = () => within(document.body);

/** Answer the first question, go to the review, and send: the answer goes to the project. */
export const Open: Story = {
  play: async ({ args }) => {
    await expect(await page().findByText('1 / 5')).toBeInTheDocument();
    await userEvent.click(await page().findByRole('radio', { name: /Cover both/ }));
    await userEvent.click(page().getByRole('button', { name: /^Review and send/ }));
    await userEvent.click(await page().findByRole('button', { name: 'Send all' }));
    await waitFor(() =>
      expect(args.write).toHaveBeenCalledWith(SAMPLE_PROJECT, [
        { questionId: 'Q-1', choiceId: 'both' },
      ]),
    );
    await waitFor(() => expect(args.onSent).toHaveBeenCalledTimes(1));
    await expect(args.onClose).toHaveBeenCalledTimes(1);
  },
};
