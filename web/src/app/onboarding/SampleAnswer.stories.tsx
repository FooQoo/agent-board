import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { modalDocsParameters } from '../../../.storybook/support/modal-docs';
import '../../shared/i18n/onboarding-strings';
import { SampleAnswer } from './SampleAnswer';

const meta = {
  title: 'App/Onboarding/SampleAnswer',
  component: SampleAnswer,
  parameters: { ...modalDocsParameters, layout: 'fullscreen' },
  args: { phone: false, locale: 'en', onSend: fn(), onClose: fn() },
} satisfies Meta<typeof SampleAnswer>;

export default meta;
type Story = StoryObj<typeof meta>;

const page = () => within(document.body);

/** The PC dialog with the guide's own question: Send answer waits for a choice, then resumes the guide. */
export const Dialog: Story = {
  play: async ({ args }) => {
    await expect(await page().findByRole('dialog')).toBeInTheDocument();
    await expect(
      await page().findByText('Which explanation is easier to read?'),
    ).toBeInTheDocument();
    await expect(page().getByRole('button', { name: 'Send answer' })).toBeDisabled();
    await userEvent.click(page().getByRole('radio', { name: 'Keep it brief' }));
    await userEvent.click(page().getByRole('button', { name: 'Send answer' }));
    await expect(args.onSend).toHaveBeenCalledTimes(1);
  },
};

/** The phone's bottom sheet with the same question, in Japanese on a phone-width window. */
export const SheetJapaneseNarrow: Story = {
  args: { phone: true, locale: 'ja' },
  // The sheet is the monitor's, so the monitor stylesheet is loaded for this Story.
  parameters: { ...modalDocsParameters, storyFrame: 'monitor', layout: 'fullscreen' },
  globals: { locale: 'ja', width: 'phone-375' },
  play: async ({ args }) => {
    await waitFor(() =>
      expect(page().getByText('案内の文章は、どちらが読みやすいですか？')).toBeVisible(),
    );
    await userEvent.click(page().getByRole('radio', { name: '短く、要点だけ' }));
    await userEvent.click(page().getByRole('button', { name: '回答を送る' }));
    await expect(args.onSend).toHaveBeenCalledTimes(1);
  },
};
