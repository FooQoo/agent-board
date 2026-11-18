import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { modalDocsParameters } from '../../../../.storybook/support/modal-docs';
import { AskAi, AskAiSheet } from './AskAi';
import { AskAiDialog } from './AskAiDialog';

const PROJECT = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const DRAFT =
  '## ログイン画面の改善\n\nログインに失敗したときの文言が分かりにくい。\n\n- 原因を一言で出す\n- 再入力しやすくする';

const meta = {
  title: 'Messages/AskAi',
  component: AskAiDialog,
  parameters: { layout: 'fullscreen', ...modalDocsParameters },
  args: { onClose: fn(), onSubmit: fn(async () => {}) },
} satisfies Meta<typeof AskAiDialog>;
export default meta;
type Story = StoryObj<typeof meta>;

const page = () => within(document.body);

/** The editor reports its text after a short pause; wait it out before sending. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 500));

/** Adds two pictures through the file input, as "Attach images" does. */
async function attachImages(): Promise<void> {
  const blob = await (await fetch('/sample-attachment.png')).blob();
  const files = [
    new File([blob], 'login.png', { type: 'image/png' }),
    new File([blob], 'screen-2.png', { type: 'image/png' }),
  ];
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error('the attachment input is missing');
  await userEvent.upload(input, files);
  await page().findByText('login.png');
}

/** The Ask AI dialog: Markdown text and images, with no epic selector and no manual creation. */
export const Dialog: Story = {
  play: async () => {
    await expect(await page().findByRole('dialog', { name: 'Ask AI' })).toBeInTheDocument();
    await waitFor(() => expect(page().getByText('What would you like done?')).toBeVisible());
    await expect(page().queryByText(/epic/i)).toBeNull();
    await expect(page().queryByRole('button', { name: /manually/i })).toBeNull();
  },
};

/** A draft text and two images, one of them placed in the text. */
export const DialogFilled: Story = {
  args: { initialText: DRAFT },
  play: async () => {
    await page().findByRole('dialog', { name: 'Ask AI' });
    await attachImages();
  },
};

/** The text is required: an empty request shows the message and sends nothing. */
export const DialogRequired: Story = {
  play: async ({ args }) => {
    await userEvent.click(await page().findByRole('button', { name: 'Send request' }));
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
    await settle();
    await userEvent.click(page().getByRole('button', { name: 'Send request' }));
    await waitFor(() =>
      expect(args.onSubmit).toHaveBeenCalledWith({
        text: 'Review the release plan',
        attachments: [],
      }),
    );
  },
};

/** "Insert in description" places an attached image in the text. */
export const DialogInsertImage: Story = {
  play: async ({ args }) => {
    await page().findByRole('dialog', { name: 'Ask AI' });
    await page().findByRole('textbox', { name: 'What would you like done?' });
    await attachImages();
    const [insert] = page().getAllByRole('button', { name: /insert in description/i });
    if (!insert) throw new Error('no insert button');
    await userEvent.click(insert);
    await waitFor(() =>
      expect(document.querySelector('.ProseMirror img.rich-image__picture')).not.toBeNull(),
    );
    await settle();
    await userEvent.click(page().getByRole('button', { name: 'Send request' }));
    await waitFor(() => expect(args.onSubmit).toHaveBeenCalled());
    const call = (args.onSubmit as ReturnType<typeof fn>).mock.calls[0]?.[0] as {
      text: string;
      attachments: unknown[];
    };
    await expect(call.text).toMatch(/!\[login\.png\]\(attachment:[0-9a-f]+\)/);
    await expect(call.attachments).toHaveLength(2);
  },
};

/** A refused send keeps the dialog and the text, and shows the reason. */
export const DialogSendFailed: Story = {
  args: {
    initialText: DRAFT,
    onSubmit: fn(async () => {
      throw new Error('The request could not be saved.');
    }),
  },
  play: async () => {
    await userEvent.click(await page().findByRole('button', { name: 'Send request' }));
    await expect(await page().findByRole('alert')).toHaveTextContent(
      'The request could not be saved.',
    );
  },
};

/** The bottom sheet for a phone: one full-width send button, the close button cancels, and the
 * label, the input box, and the images share one left edge. */
export const Sheet: Story = {
  args: { kind: 'sheet' },
  parameters: { storyFrame: 'monitor' },
  globals: { width: 'phone-375' },
  play: async () => {
    const sheet = await page().findByRole('dialog', { name: 'Ask AI' });
    const send = page().getByRole('button', { name: 'Send request' });
    await expect(send).toBeVisible();
    await expect(page().queryByRole('button', { name: /^Cancel$/ })).toBeNull();
    const left = (selector: string) => {
      const element = sheet.querySelector(selector);
      if (element === null) throw new Error(`${selector} is missing`);
      return Math.round(element.getBoundingClientRect().left);
    };
    const edge = left('.ask-ai__label');
    await expect(left('.ask-ai__box')).toBe(edge);
    await expect(left('.editor-attachments__header')).toBe(edge);
    await expect(left('.ask-ai__note')).toBe(edge);
    await expect(Math.round(send.getBoundingClientRect().width)).toBe(
      Math.round(sheet.querySelector('.ask-ai__box')?.getBoundingClientRect().width ?? 0),
    );
  },
};

/** The sheet with a draft text and two images. */
export const SheetFilled: Story = {
  args: { kind: 'sheet', initialText: DRAFT },
  parameters: { storyFrame: 'monitor' },
  globals: { width: 'phone-375' },
  play: async () => {
    await page().findByRole('dialog', { name: 'Ask AI' });
    await attachImages();
  },
};

/** An empty request in the sheet shows the message above the send button. */
export const SheetRequired: Story = {
  args: { kind: 'sheet' },
  parameters: { storyFrame: 'monitor' },
  globals: { width: 'phone-375' },
  play: async ({ args }) => {
    await userEvent.click(await page().findByRole('button', { name: 'Send request' }));
    await expect(await page().findByRole('alert')).toHaveTextContent('Enter your request.');
    await expect(args.onSubmit).not.toHaveBeenCalled();
  },
};

/** The sheet in Japanese. */
export const SheetJapanese: Story = {
  args: { kind: 'sheet', initialText: DRAFT },
  parameters: { storyFrame: 'monitor' },
  globals: { width: 'phone-375', locale: 'ja' },
  play: async () => {
    await expect(await page().findByRole('dialog', { name: 'AI に依頼' })).toBeInTheDocument();
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
