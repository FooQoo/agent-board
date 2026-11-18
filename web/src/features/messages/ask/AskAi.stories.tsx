import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { modalDocsParameters } from '../../../../.storybook/support/modal-docs';
import { AskAi, AskAiSheet } from './AskAi';
import { AskAiDialog } from './AskAiDialog';

const PROJECT = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const DRAFT =
  'ログインに失敗したときの文言が分かりにくい。原因を一言で出し、再入力しやすくしてほしい。';

const meta = {
  title: 'Messages/AskAi',
  component: AskAiDialog,
  parameters: { layout: 'fullscreen', ...modalDocsParameters },
  args: { onClose: fn(), onSubmit: fn(async () => {}) },
} satisfies Meta<typeof AskAiDialog>;
export default meta;
type Story = StoryObj<typeof meta>;

const page = () => within(document.body);
const PHONE = {
  args: { kind: 'sheet' as const },
  parameters: { storyFrame: 'monitor' as const },
  globals: { width: 'phone-375' },
};

/** Adds two pictures through the file input, as the "Image" button does. */
async function attachImages(): Promise<void> {
  const blob = await (await fetch('/sample-attachment.png')).blob();
  const files = [
    new File([blob], 'login.png', { type: 'image/png' }),
    new File([blob], 'screen-2.png', { type: 'image/png' }),
  ];
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error('the image input is missing');
  await userEvent.upload(input, files);
  await page().findByRole('button', { name: 'Remove login.png' });
}

const sendButton = () => page().findByRole('button', { name: /Send request|依頼する/ });
const failing = fn(async () => {
  throw new Error('The request could not be saved.');
});

/** The chat-style composer: the title, a field that fills the height, and "Image" and "Send". */
export const Dialog: Story = {
  play: async () => {
    await expect(await page().findByRole('dialog', { name: 'Ask AI' })).toBeInTheDocument();
    // The dialog fades in; wait until it is shown.
    await waitFor(() =>
      expect(page().getByRole('textbox', { name: 'What would you like done?' })).toBeVisible(),
    );
    await expect(page().getByRole('button', { name: 'Image' })).toBeVisible();
    await expect(await sendButton()).toBeDisabled();
    await expect(page().queryByText(/epic/i)).toBeNull();
    await expect(page().queryByRole('button', { name: /manually/i })).toBeNull();
  },
};

/** A typed request enables "Send request". */
export const DialogTyped: Story = {
  args: { initialText: DRAFT },
  play: async () => {
    await expect(await sendButton()).toBeEnabled();
  },
};

/** A request and two attached images as thumbnails above the toolbar. */
export const DialogWithImages: Story = {
  args: { initialText: DRAFT },
  play: async () => {
    await page().findByRole('dialog', { name: 'Ask AI' });
    await attachImages();
    await expect(page().getAllByRole('img')).toHaveLength(2);
  },
};

/** An image alone enables "Send request"; the missing text is then asked for. Blank text alone keeps it disabled. */
export const DialogImageOnly: Story = {
  play: async ({ args }) => {
    await page().findByRole('dialog', { name: 'Ask AI' });
    await attachImages();
    await userEvent.click(await sendButton());
    await waitFor(() => expect(page().getByText('Enter your request.')).toBeVisible());
    await expect(args.onSubmit).not.toHaveBeenCalled();
  },
};

/** Typing the text and sending hands over the text and no images. */
export const DialogSubmit: Story = {
  play: async ({ args }) => {
    const field = await page().findByRole('textbox', { name: 'What would you like done?' });
    await userEvent.click(field);
    await userEvent.keyboard('Review the release plan');
    await userEvent.click(await sendButton());
    await waitFor(() =>
      expect(args.onSubmit).toHaveBeenCalledWith({
        text: 'Review the release plan',
        attachments: [],
      }),
    );
  },
};

/** A refused send keeps the dialog, the text and the images, and shows the reason. */
export const DialogSendFailed: Story = {
  args: { initialText: DRAFT, onSubmit: failing },
  play: async () => {
    await page().findByRole('dialog', { name: 'Ask AI' });
    await attachImages();
    await userEvent.click(await sendButton());
    await expect(await page().findByRole('alert')).toHaveTextContent(
      'The request could not be saved.',
    );
    await expect(page().getByRole('textbox')).toHaveValue(DRAFT);
    await expect(page().getByRole('button', { name: 'Remove login.png' })).toBeVisible();
  },
};

/** The composer in the dark theme with images. */
export const DialogDark: Story = {
  args: { initialText: DRAFT },
  globals: { mode: 'dark' },
  play: async () => {
    await page().findByRole('dialog', { name: 'Ask AI' });
    await attachImages();
  },
};

/** The composer in Japanese. */
export const DialogJapanese: Story = {
  args: { initialText: DRAFT },
  globals: { locale: 'ja' },
  play: async () => {
    await expect(await page().findByRole('dialog', { name: 'AI に依頼' })).toBeInTheDocument();
    await waitFor(() => expect(page().getByRole('button', { name: '画像' })).toBeVisible());
    await expect(await sendButton()).toBeEnabled();
  },
};

/** The bottom sheet for a phone: the toolbar is fixed at the bottom of the sheet. */
export const Sheet: Story = {
  ...PHONE,
  play: async () => {
    const sheet = await page().findByRole('dialog', { name: 'Ask AI' });
    await expect(await sendButton()).toBeVisible();
    await expect(page().getByRole('button', { name: 'Image' })).toBeVisible();
    await expect(page().queryByRole('button', { name: /^Cancel$/ })).toBeNull();
    const field = page().getByRole('textbox', { name: 'What would you like done?' });
    // 16px or more keeps iOS from zooming in when the field gets the focus.
    await expect(parseFloat(getComputedStyle(field).fontSize)).toBeGreaterThanOrEqual(16);
    // The toolbar is inside the sheet, at its foot.
    const toolbar = sheet.querySelector('.ask-ai__toolbar')?.getBoundingClientRect();
    const frame = sheet.getBoundingClientRect();
    await expect(toolbar && toolbar.bottom <= frame.bottom && toolbar.top >= frame.top).toBe(true);
  },
};

/** The sheet with a typed request and two images. */
export const SheetWithImages: Story = {
  ...PHONE,
  args: { kind: 'sheet', initialText: DRAFT },
  play: async () => {
    await page().findByRole('dialog', { name: 'Ask AI' });
    await attachImages();
  },
};

/** An image without text in the sheet shows the message above the toolbar. */
export const SheetRequired: Story = {
  ...PHONE,
  play: async ({ args }) => {
    await page().findByRole('dialog', { name: 'Ask AI' });
    await attachImages();
    await userEvent.click(await sendButton());
    await expect(await page().findByRole('alert')).toHaveTextContent('Enter your request.');
    await expect(args.onSubmit).not.toHaveBeenCalled();
  },
};

/** A refused send in the sheet keeps the text and shows the reason. */
export const SheetSendFailed: Story = {
  ...PHONE,
  args: { kind: 'sheet', initialText: DRAFT, onSubmit: failing },
  play: async () => {
    await userEvent.click(await sendButton());
    await expect(await page().findByRole('alert')).toHaveTextContent(
      'The request could not be saved.',
    );
    await expect(page().getByRole('textbox')).toHaveValue(DRAFT);
  },
};

/** The sheet in Japanese. */
export const SheetJapanese: Story = {
  ...PHONE,
  args: { kind: 'sheet', initialText: DRAFT },
  globals: { width: 'phone-375', locale: 'ja' },
  play: async () => {
    await expect(await page().findByRole('dialog', { name: 'AI に依頼' })).toBeInTheDocument();
  },
};

/** The sheet in the dark theme. */
export const SheetDark: Story = {
  ...PHONE,
  args: { kind: 'sheet', initialText: DRAFT },
  globals: { width: 'phone-375', mode: 'dark' },
  play: async () => {
    await expect(await page().findByRole('dialog', { name: 'Ask AI' })).toBeInTheDocument();
  },
};

/** The connected dialog the board opens; it sends its own request when it is submitted. */
export const Connected: StoryObj<typeof AskAi> = {
  render: (args) => <AskAi {...args} projectId={PROJECT} onClose={fn()} />,
  play: async () => {
    await expect(await page().findByRole('dialog', { name: 'Ask AI' })).toBeInTheDocument();
  },
};

/** The connected sheet the phone's messages band opens. */
export const ConnectedSheet: StoryObj<typeof AskAiSheet> = {
  render: () => <AskAiSheet projectId={PROJECT} onClose={fn()} />,
  parameters: { storyFrame: 'monitor' },
  globals: { width: 'phone-375' },
  play: async () => {
    await expect(await page().findByRole('dialog', { name: 'Ask AI' })).toBeInTheDocument();
  },
};
