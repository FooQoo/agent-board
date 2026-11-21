import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { modalDocsParameters } from '../../../../.storybook/support/modal-docs';
import { MessageCenter, type MessageCenterProps } from './MessageCenter';
import {
  answeredSample,
  resolveSampleAttachment,
  SAMPLE_PROJECT,
  sampleMessages,
  sampleMessagesApi,
  sampleSummaries,
} from './messageSamples';
import { type MessagesPanelTarget, useMessagesPanel } from './useMessagesPanel';
import type { MessagesApi, SummariesApi } from './model/messages';

interface HarnessProps {
  variant: 'board' | 'phone';
  /** Where the list is open at first; none keeps it closed. */
  initial?: MessagesPanelTarget;
  answer: MessagesApi['answer'];
  withdraw: MessagesApi['withdraw'];
  /** Replaces the sample's read, to give a message another body. */
  read?: MessagesApi['read'];
  onAsk?: () => void;
  /** Adds a question the person answered that no agent took in yet. */
  withAnswered?: boolean;
  /** Lists no message at all. */
  empty?: boolean;
  /** Gives the list its Summary tab; the value is what the list returns (a list or a failing read). */
  summaries?: { dismiss: SummariesApi['dismiss']; none?: boolean };
  /** The phone list's pull to refresh. */
  onRefresh?: () => void;
  refreshing?: boolean;
  previewPull?: MessageCenterProps['previewPull'];
}

/** The band and the list it opens, over the sample messages. */
function Harness({
  variant,
  initial,
  answer,
  withdraw,
  read,
  onAsk,
  withAnswered,
  empty,
  summaries,
  onRefresh,
  refreshing,
  previewPull,
}: HarnessProps) {
  const { i18n } = useTranslation();
  const panel = useMessagesPanel();
  const messages = useMemo(
    () =>
      empty
        ? []
        : [
            ...sampleMessages(i18n.language),
            ...(withAnswered ? [answeredSample(i18n.language)] : []),
          ],
    [i18n.language, withAnswered, empty],
  );
  const api = useMemo(
    () =>
      sampleMessagesApi(i18n.language, {
        answer,
        withdraw,
        ...(read ? { read } : {}),
        ...(summaries
          ? {
              summaries: {
                list: async () => (summaries.none ? [] : sampleSummaries(i18n.language)),
                dismiss: summaries.dismiss,
              },
            }
          : {}),
      }),
    [i18n.language, answer, withdraw, read, summaries],
  );
  const { open } = panel;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the list opens once, as a Story starts.
  useEffect(() => {
    if (initial) open(initial);
  }, []);
  return (
    <div style={{ padding: variant === 'board' ? 24 : 8 }}>
      <MessageCenter
        projectId={SAMPLE_PROJECT}
        messages={messages}
        variant={variant}
        panel={panel}
        api={api}
        onChanged={() => {}}
        onAsk={onAsk}
        onRefresh={onRefresh}
        refreshing={refreshing}
        previewPull={previewPull}
        resolveAttachment={resolveSampleAttachment}
      />
    </div>
  );
}

const meta = {
  title: 'Task/Messages/MessageCenter',
  component: Harness,
  args: {
    variant: 'board',
    answer: fn(async () => undefined),
    withdraw: fn(async () => undefined),
  },
  parameters: { layout: 'fullscreen', ...modalDocsParameters },
  globals: { locale: 'ja' },
} satisfies Meta<typeof Harness>;

export default meta;
type Story = StoryObj<typeof meta>;

const page = () => within(document.body);
const phone = { storyFrame: 'monitor', layout: 'fullscreen', ...modalDocsParameters } as const;

/** The list opens from the band; "AI の質問" shows the two questions, newest first. */
/** The Markdown renderer loads on demand; on a slow runner the raw text shows first. */
const MARKDOWN_LOADED = { timeout: 10_000 };

export const ListFromAi: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: '質問・依頼を確認' }));
    const list = await page().findByRole('dialog', { name: 'メッセージ' });
    await expect(within(list).getAllByRole('tab')).toHaveLength(2);
    // Both tabs' pages are drawn side by side for the swipe; only the selected one is a tab panel.
    const panel = within(list).getByRole('tabpanel');
    await expect(within(panel).getAllByText('未回答')).toHaveLength(2);
    await expect(within(panel).queryByText('受け取り待ち')).toBeNull();
  },
};

/** "あなたの依頼": a request that no agent picked up yet says so. */
export const ListFromYou: Story = {
  args: { initial: { tab: 'fromYou' } },
  play: async () => {
    const list = await page().findByRole('dialog', { name: 'メッセージ' });
    const panel = within(list).getByRole('tabpanel');
    await expect(within(panel).getByText('受け取り待ち')).toBeInTheDocument();
    await expect(within(panel).queryByText('未回答')).toBeNull();
    // A message opened from the list offers the way back to it.
    const row = within(list).getByText('受け取り待ち').closest('button');
    if (!row) throw new Error('The request row is not a button.');
    await userEvent.click(row);
    await userEvent.click(await within(list).findByRole('button', { name: '一覧へ戻る' }));
    await expect(await within(list).findByText('受け取り待ち')).toBeInTheDocument();
  },
};

/** An open question: the question on the left, the answer on the right, the buttons pinned below. */
export const QuestionOpen: Story = {
  args: { initial: { tab: 'fromAi', openId: 'Q-12' } },
  play: async () => {
    const dialog = await page().findByRole('dialog', { name: 'メッセージ' });
    await within(dialog).findByRole(
      'heading',
      { name: '既存のユーザーデータの扱い' },
      MARKDOWN_LOADED,
    );
    // Opened straight from its card, the question has no list to go back to.
    await expect(within(dialog).queryByRole('button', { name: '一覧へ戻る' })).toBeNull();
    const send = within(dialog).getByRole('button', { name: '回答を送る' });
    await expect(send).toBeDisabled();
    await expect(within(dialog).getByRole('button', { name: 'あとでやる' })).toBeInTheDocument();
    await expect(
      within(dialog).getByText(/返事があるまで #21 #22 は止まります/),
    ).toBeInTheDocument();
    const question = dialog.querySelector('.decision-panel__question');
    const answer = dialog.querySelector('.decision-panel__answer');
    if (!question || !answer) throw new Error('The panel has no two columns.');
    // Two columns on the PC: the answer sits to the right of the question.
    await expect(answer.getBoundingClientRect().left).toBeGreaterThanOrEqual(
      question.getBoundingClientRect().right - 1,
    );
  },
};

/**
 * An answered question no agent took in yet stays in "AI の質問" without counting as unanswered,
 * and opens read only with the answer.
 */
export const AnsweredWaitingPickup: Story = {
  args: { withAnswered: true, initial: { tab: 'fromAi' } },
  play: async ({ canvasElement }) => {
    const list = await page().findByRole('dialog', { name: 'メッセージ' });
    await expect(within(list).getAllByText('未回答')).toHaveLength(2);
    const state = within(list).getByText('回答済み・AI の受け取り待ち');
    // The band counts only what waits for the person.
    const band = within(canvasElement).getByRole('region', { name: 'メッセージ', hidden: true });
    await expect(band.querySelector('strong')).toHaveTextContent('2');
    const row = state.closest('button');
    if (!row) throw new Error('The answered row is not a button.');
    await userEvent.click(row);
    await within(list).findByRole('heading', { name: 'ログイン画面の文言' }, MARKDOWN_LOADED);
    const answer = within(list).getByRole('region', { name: 'あなたの回答' });
    await expect(answer).toHaveTextContent('変えてよい — ボタンの色はそのままで。');
    await expect(within(list).queryByRole('button', { name: '回答を送る' })).toBeNull();
    await expect(within(list).queryByRole('radio')).toBeNull();
  },
};

/** A question with choices takes a choice, a note, or both; with neither, Send stays disabled. */
export const QuestionNeedsChoiceOrNote: Story = {
  args: { initial: { tab: 'fromAi', openId: 'Q-13' } },
  globals: { locale: 'en', mode: 'dark' },
  play: async ({ args }) => {
    const dialog = await page().findByRole('dialog', { name: 'Messages' });
    const send = await within(dialog).findByRole('button', { name: 'Send answer' });
    await expect(send).toBeDisabled();
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Note' }), 'Not sure');
    await expect(send).toBeEnabled();
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Email and password only' }));
    await expect(send).toBeEnabled();
    await userEvent.click(send);
    await waitFor(() =>
      expect(args.answer).toHaveBeenCalledWith(
        SAMPLE_PROJECT,
        [{ questionId: 'Q-13', choiceId: 'mail', text: 'Not sure' }],
        [],
      ),
    );
  },
};

/** Adds a picture through the file input, as the "画像" button does. */
async function attachAnswerImage(dialog: HTMLElement, name: string): Promise<void> {
  const blob = await (await fetch('/sample-attachment.png')).blob();
  const input = dialog.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error('the image input is missing');
  await userEvent.upload(input, new File([blob], name, { type: 'image/png' }));
}

/** An answer with options takes a picture: it shows as a thumbnail, goes with the answer, and can be removed. */
export const AnswerWithImage: Story = {
  args: { initial: { tab: 'fromAi', openId: 'Q-13' } },
  play: async ({ args }) => {
    const dialog = await page().findByRole('dialog', { name: 'メッセージ' });
    await within(dialog).findByRole('radio', { name: 'メールとパスワードだけ' });
    await attachAnswerImage(dialog, 'before.png');
    await within(dialog).findByRole('button', { name: 'before.png を外す' });
    await attachAnswerImage(dialog, 'after.png');
    await userEvent.click(within(dialog).getByRole('button', { name: 'before.png を外す' }));
    await expect(within(dialog).queryByRole('button', { name: 'before.png を外す' })).toBeNull();
    await userEvent.click(within(dialog).getByRole('radio', { name: 'メールとパスワードだけ' }));
    await userEvent.click(within(dialog).getByRole('button', { name: '回答を送る' }));
    await waitFor(() => expect(args.answer).toHaveBeenCalledTimes(1));
    const call = (args.answer as ReturnType<typeof fn>).mock.calls[0] ?? [];
    await expect(call[1]).toEqual([{ questionId: 'Q-13', choiceId: 'mail' }]);
    await expect((call[2] as { name: string }[]).map((image) => image.name)).toEqual(['after.png']);
  },
};

/** On a phone the thumbnails are about 88px with a 44px remove target, and a tap opens the viewer. */
export const AnswerImagesTappableOnPhone: Story = {
  args: { variant: 'phone', initial: { tab: 'fromAi', openId: 'Q-13' } },
  parameters: phone,
  globals: { locale: 'en', width: 'phone-375' },
  play: async () => {
    const dialog = await page().findByRole('dialog', { name: 'Messages' });
    await within(dialog).findByRole('radio', { name: 'Email and password only' });
    for (const name of ['one.png', 'two.png', 'three.png']) await attachAnswerImage(dialog, name);
    const open = await within(dialog).findByRole('button', { name: 'Preview one.png' });
    await expect(open.offsetWidth).toBeGreaterThanOrEqual(88);
    await expect(open.offsetHeight).toBeGreaterThanOrEqual(88);
    const remove = within(dialog).getByRole('button', { name: 'Remove one.png' });
    await expect(remove.offsetWidth).toBeGreaterThanOrEqual(44);
    await expect(remove.offsetHeight).toBeGreaterThanOrEqual(44);
    await userEvent.click(open);
    await page().findByRole('dialog', { name: 'one.png' });
  },
};

/** A question without options takes a note and a picture, and the picture can be pasted. */
export const AnswerTextWithPastedImage: Story = {
  args: {
    initial: { tab: 'fromAi', openId: 'Q-13' },
    read: async (_projectId, id) => ({
      id,
      type: 'question',
      body: 'どの画面で起きましたか。',
      choices: [],
      recommendedChoiceId: null,
      status: 'open',
      referencedBy: [14],
    }),
  },
  globals: { locale: 'en' },
  play: async ({ args }) => {
    const dialog = await page().findByRole('dialog', { name: 'Messages' });
    const note = await within(dialog).findByRole('textbox', { name: 'Note' });
    await userEvent.type(note, 'The login screen');
    const blob = await (await fetch('/sample-attachment.png')).blob();
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', {
      value: { files: [new File([blob], 'image.png', { type: 'image/png' })] },
    });
    note.dispatchEvent(paste);
    await within(dialog).findByRole('button', { name: 'Remove image.png' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send answer' }));
    await waitFor(() => expect(args.answer).toHaveBeenCalledTimes(1));
    const call = (args.answer as ReturnType<typeof fn>).mock.calls[0] ?? [];
    await expect((call[2] as unknown[]).length).toBe(1);
  },
};

const answeredWithImages: MessagesApi['read'] = async (_projectId, id) => ({
  id,
  type: 'question',
  body: 'どちらのレイアウトにしますか。',
  choices: [
    { id: 'a', label: 'A案' },
    { id: 'b', label: 'B案' },
  ],
  recommendedChoiceId: null,
  status: 'answered',
  referencedBy: [14],
  reply: { choiceLabel: 'A案', text: '余白は少し詰めて。', images: ['mock.png'], acceptedAt: null },
});

/** An answer's pictures are shown under the answer, read from the question's own route. */
export const AnsweredWithImage: Story = {
  args: {
    withAnswered: true,
    initial: { tab: 'fromAi', openId: 'Q-11' },
    read: answeredWithImages,
  },
  play: async () => {
    const dialog = await page().findByRole('dialog', { name: 'メッセージ' });
    const answer = await within(dialog).findByRole('region', { name: 'あなたの回答' });
    const image = await waitFor(() => {
      const found = answer.querySelector('img.md__image-picture');
      expect(found).not.toBeNull();
      return found as HTMLImageElement;
    });
    await expect(image.getAttribute('src')).toBe(
      `/api/projects/${SAMPLE_PROJECT}/messages/Q-11/attachments/mock.png`,
    );
  },
};

/** The phone: the answer sheet takes a picture, and the sheet does not grow sideways. */
export const PhoneAnswerWithImage: Story = {
  args: { variant: 'phone', initial: { tab: 'fromAi', openId: 'Q-13' } },
  parameters: phone,
  globals: { locale: 'ja', width: 'phone-375' },
  play: async () => {
    const sheet = await page().findByRole('dialog', { name: 'メッセージ' });
    await within(sheet).findByRole('radio', { name: 'メールとパスワードだけ' });
    await attachAnswerImage(sheet, 'phone-shot.png');
    await within(sheet).findByRole('button', { name: 'phone-shot.png を外す' });
    const body = sheet.querySelector('.surface__body');
    if (!(body instanceof HTMLElement)) throw new Error('The sheet has no body.');
    await expect(body.scrollWidth).toBeLessThanOrEqual(body.clientWidth + 1);
  },
};

/** An open request: its text and picture, and "取り下げる" while it waits to be picked up. */
export const RequestOpen: Story = {
  args: { initial: { tab: 'fromYou', openId: 'Q-14' } },
  play: async ({ args }) => {
    const dialog = await page().findByRole('dialog', { name: 'メッセージ' });
    await within(dialog).findByText(/パスワードを忘れたときの導線を足してください/);
    await userEvent.click(within(dialog).getByRole('button', { name: '取り下げる' }));
    await waitFor(() => expect(args.withdraw).toHaveBeenCalledWith(SAMPLE_PROJECT, 'Q-14'));
  },
};

/** An image written `attachments/<name>` in a request body is read from the message's own route. */
export const RequestWithImage: Story = {
  args: {
    initial: { tab: 'fromYou', openId: 'Q-14' },
    read: async (_projectId, id) => ({
      id,
      type: 'request',
      body: '![画面](attachments/shot.png)',
      choices: [],
      recommendedChoiceId: null,
      status: 'open',
      referencedBy: [],
    }),
  },
  play: async () => {
    const dialog = await page().findByRole('dialog', { name: 'メッセージ' });
    const image = await waitFor(() => {
      const found = dialog.querySelector('img.md__image-picture');
      expect(found).not.toBeNull();
      return found as HTMLImageElement;
    });
    await expect(image.getAttribute('src')).toBe(
      `/api/projects/${SAMPLE_PROJECT}/messages/Q-14/attachments/shot.png`,
    );
  },
};

const questionWithImageBody =
  'どちらのレイアウトにしますか。\n\n![レイアウト案](attachments/layout.png)';

/** An image attached to a question is read from the message's own route, as a request's is. */
export const QuestionWithImage: Story = {
  args: {
    initial: { tab: 'fromAi', openId: 'Q-12' },
    read: async (_projectId, id) => ({
      id,
      type: 'question',
      body: questionWithImageBody,
      choices: [
        { id: 'a', label: 'A案' },
        { id: 'b', label: 'B案' },
      ],
      recommendedChoiceId: null,
      status: 'open',
      referencedBy: [14],
    }),
  },
  play: async () => {
    const dialog = await page().findByRole('dialog', { name: 'メッセージ' });
    const image = await waitFor(() => {
      const found = dialog.querySelector('img.md__image-picture');
      expect(found).not.toBeNull();
      return found as HTMLImageElement;
    });
    await expect(image.getAttribute('src')).toBe(
      `/api/projects/${SAMPLE_PROJECT}/messages/Q-12/attachments/layout.png`,
    );
  },
};

/** The phone: a question with an image keeps the picture inside the sheet. */
export const PhoneQuestionWithImage: Story = {
  args: {
    variant: 'phone',
    initial: { tab: 'fromAi', openId: 'Q-12' },
    read: async (_projectId, id) => ({
      id,
      type: 'question',
      body: questionWithImageBody,
      choices: [
        { id: 'a', label: 'A案' },
        { id: 'b', label: 'B案' },
      ],
      recommendedChoiceId: null,
      status: 'open',
      referencedBy: [14],
    }),
  },
  parameters: phone,
  globals: { locale: 'ja', width: 'phone-375' },
  play: async () => {
    const sheet = await page().findByRole('dialog', { name: 'メッセージ' });
    const image = await waitFor(() => {
      const found = sheet.querySelector('img.md__image-picture');
      expect(found).not.toBeNull();
      return found as HTMLImageElement;
    });
    await expect(image.getAttribute('src')).toBe(
      `/api/projects/${SAMPLE_PROJECT}/messages/Q-12/attachments/layout.png`,
    );
    const body = sheet.querySelector('.surface__body');
    if (!(body instanceof HTMLElement)) throw new Error('The sheet has no body.');
    await expect(body.scrollWidth).toBeLessThanOrEqual(body.clientWidth + 1);
  },
};

/** English, dark: the list. */
export const ListEnDark: Story = {
  args: { initial: { tab: 'fromAi' } },
  globals: { locale: 'en', mode: 'dark' },
  play: async () => {
    const list = await page().findByRole('dialog', { name: 'Messages' });
    await expect(within(list).getAllByText('Unanswered')).toHaveLength(2);
  },
};

/** Japanese, dark: an open question. */
export const QuestionOpenJaDark: Story = {
  args: { initial: { tab: 'fromAi', openId: 'Q-12' } },
  globals: { locale: 'ja', mode: 'dark' },
};

/** The phone: the band with "AI に依頼" and "質問・依頼を確認". */
export const PhoneBand: Story = {
  args: { variant: 'phone', onAsk: fn() },
  parameters: phone,
  globals: { locale: 'ja', width: 'phone-375' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button', { name: 'AI に依頼' })).toBeVisible();
  },
};

/** The phone: the list is a bottom sheet. */
export const PhoneList: Story = {
  args: { variant: 'phone', initial: { tab: 'fromAi' } },
  parameters: phone,
  globals: { locale: 'ja', width: 'phone-375' },
  play: async () => {
    const sheet = await page().findByRole('dialog', { name: 'メッセージ' });
    await expect(sheet.className).toContain('surface-sheet');
  },
};

/**
 * A mouse press that Embla reads as a swipe: events one frame apart, stamped by hand so the speed
 * is the same on every machine.
 */
let clock = 0;
function drag(target: Element, from: number, to: number, y: number) {
  const steps = [from, from + (to - from) / 2, to];
  steps.forEach((x, index) => {
    const type = index === 0 ? 'mousedown' : 'mousemove';
    const event = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: 1,
      clientX: x,
      clientY: y,
    });
    clock += 16;
    Object.defineProperty(event, 'timeStamp', { value: clock });
    target.dispatchEvent(event);
  });
  const up = new MouseEvent('mouseup', {
    bubbles: true,
    cancelable: true,
    clientX: to,
    clientY: y,
  });
  clock += 16;
  Object.defineProperty(up, 'timeStamp', { value: clock });
  target.dispatchEvent(up);
}

/** The phone: a sideways swipe on the list switches the tabs; a tap on a row still opens it. */
export const PhoneSwipeTabs: Story = {
  args: { variant: 'phone', initial: { tab: 'fromAi' } },
  parameters: phone,
  globals: { locale: 'ja', width: 'phone-375' },
  play: async () => {
    const sheet = await page().findByRole('dialog', { name: 'メッセージ' });
    const [fromAi, fromYou] = within(sheet).getAllByRole('tab');
    if (!fromAi || !fromYou) throw new Error('The list has no two tabs.');
    await expect(fromAi).toHaveAttribute('aria-selected', 'true');
    const viewport = sheet.querySelector('.message-list__viewport');
    if (!viewport) throw new Error('The list has no swipe viewport.');
    const rect = viewport.getBoundingClientRect();
    const y = rect.top + 40;
    // A left swipe moves to "あなたの依頼".
    drag(viewport, rect.right - 20, rect.left + 20, y);
    await waitFor(() => expect(fromYou).toHaveAttribute('aria-selected', 'true'));
    await expect(await within(sheet).findByText('受け取り待ち')).toBeVisible();
    // A right swipe moves back to "AI の質問".
    drag(viewport, rect.left + 20, rect.right - 20, y);
    await waitFor(() => expect(fromAi).toHaveAttribute('aria-selected', 'true'));
    // A tap on the other tab still switches, and a tap on a row still opens it.
    await userEvent.click(fromYou);
    await waitFor(() => expect(fromYou).toHaveAttribute('aria-selected', 'true'));
    const row = (await within(sheet).findByText('受け取り待ち')).closest('button');
    if (!row) throw new Error('The request row is not a button.');
    await userEvent.click(row);
    await within(sheet).findByRole('button', { name: '一覧へ戻る' });
  },
};

/** The phone: with both tabs empty, a swipe low in the sheet, far below the message, still works. */
export const PhoneSwipeEmpty: Story = {
  args: { variant: 'phone', initial: { tab: 'fromAi' }, empty: true },
  parameters: phone,
  globals: { locale: 'ja', width: 'phone-375' },
  play: async () => {
    const sheet = await page().findByRole('dialog', { name: 'メッセージ' });
    const [fromAi, fromYou] = within(sheet).getAllByRole('tab');
    if (!fromAi || !fromYou) throw new Error('The list has no two tabs.');
    const viewport = sheet.querySelector('.message-list__viewport');
    const body = sheet.querySelector('.surface__body');
    if (!viewport || !body) throw new Error('The list has no swipe viewport.');
    const rect = viewport.getBoundingClientRect();
    // The swipe area reaches the bottom of the sheet body, not just the one-line message.
    await expect(rect.bottom).toBeGreaterThanOrEqual(body.getBoundingClientRect().bottom - 16);
    const y = rect.bottom - 40;
    drag(viewport, rect.right - 20, rect.left + 20, y);
    await waitFor(() => expect(fromYou).toHaveAttribute('aria-selected', 'true'));
    drag(viewport, rect.left + 20, rect.right - 20, y);
    await waitFor(() => expect(fromAi).toHaveAttribute('aria-selected', 'true'));
  },
};

/** The phone: an open question stacks the answer under it, with the buttons pinned. */
export const PhoneQuestion: Story = {
  args: { variant: 'phone', initial: { tab: 'fromAi', openId: 'Q-12' } },
  parameters: phone,
  globals: { locale: 'ja', width: 'phone-375' },
  play: async () => {
    const sheet = await page().findByRole('dialog', { name: 'メッセージ' });
    await within(sheet).findByRole('button', { name: '回答を送る' });
    const question = sheet.querySelector('.decision-panel__question');
    const answer = sheet.querySelector('.decision-panel__answer');
    if (!question || !answer) throw new Error('The panel has no question and answer.');
    await expect(answer.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      question.getBoundingClientRect().bottom - 1,
    );
  },
};

/** The question's detail is still loading: the spinner sits in the middle of the body, PC and phone. */
const loadingDetail: HarnessProps['read'] = () => new Promise(() => {});

function expectSpinnerCentred(root: HTMLElement) {
  const spinner = root.querySelector('.message-detail__state [role="status"]');
  const body = root.querySelector('.surface__body');
  if (!spinner || !body) throw new Error('The loading detail has no spinner or body.');
  const s = spinner.getBoundingClientRect();
  const b = body.getBoundingClientRect();
  expect(Math.abs(s.left + s.width / 2 - (b.left + b.width / 2))).toBeLessThanOrEqual(24);
  // The body may be taller than its content; the spinner is in the middle third, not at the top.
  expect(s.top + s.height / 2).toBeGreaterThan(b.top + b.height / 3);
  expect(s.top + s.height / 2).toBeLessThan(b.top + (b.height * 2) / 3);
}

export const DetailLoading: Story = {
  args: { initial: { tab: 'fromAi', openId: 'Q-12' }, read: loadingDetail },
  play: async () => {
    const dialog = await page().findByRole('dialog', { name: 'メッセージ' });
    await within(dialog).findByRole('status', { name: 'メッセージを読み込んでいます…' });
    expectSpinnerCentred(dialog);
  },
};

export const PhoneDetailLoading: Story = {
  args: { variant: 'phone', initial: { tab: 'fromAi', openId: 'Q-12' }, read: loadingDetail },
  parameters: phone,
  globals: { locale: 'ja', mode: 'dark', width: 'phone-375' },
  play: async () => {
    const sheet = await page().findByRole('dialog', { name: 'メッセージ' });
    await within(sheet).findByRole('status', { name: 'メッセージを読み込んでいます…' });
    expectSpinnerCentred(sheet);
  },
};

/** The phone: an open request, English and dark. */
export const PhoneRequestEnDark: Story = {
  args: { variant: 'phone', initial: { tab: 'fromYou', openId: 'Q-14' } },
  parameters: phone,
  globals: { locale: 'en', mode: 'dark', width: 'phone-375' },
  play: async () => {
    const sheet = await page().findByRole('dialog', { name: 'Messages' });
    await expect(
      await within(sheet).findByRole('button', { name: 'Withdraw' }),
    ).toBeInTheDocument();
  },
};

/** The phone: a question opened from the list has "一覧へ戻る" in the footer in place of "あとでやる". */
export const PhoneQuestionFromList: Story = {
  args: { variant: 'phone', initial: { tab: 'fromAi' } },
  parameters: phone,
  globals: { locale: 'ja', mode: 'dark', width: 'phone-375' },
  play: async () => {
    const sheet = await page().findByRole('dialog', { name: 'メッセージ' });
    const row = (await within(sheet).findAllByText('未回答'))[0]?.closest('button');
    if (!row) throw new Error('The question row is not a button.');
    await userEvent.click(row);
    await within(sheet).findByRole('button', { name: '回答を送る' });
    await expect(within(sheet).queryByRole('button', { name: 'あとでやる' })).toBeNull();
    const footer = sheet.querySelector('.surface__footer');
    if (!(footer instanceof HTMLElement)) throw new Error('The sheet has no footer.');
    const back = within(footer).getByRole('button', { name: '一覧へ戻る' });
    // The in-body button is gone: the only "一覧へ戻る" is the footer's.
    await expect(within(sheet).getAllByRole('button', { name: '一覧へ戻る' })).toHaveLength(1);
    await userEvent.click(back);
    await expect(await within(sheet).findAllByText('未回答')).toHaveLength(2);
  },
};

const markdownBody = `## 認証方式の選び方

**パスワード認証**を残すか、\`passkey\` に切り替えるかを決めてください。詳しくは [設計メモ](#design) を参照。

- 既存ユーザーの扱い
  - 初回ログイン時に変換する
  - 再設定をお願いする
- 外部アカウント

1. 方式を決める
2. 移行日を決める

| 方式 | 利点 | 注意点 |
| --- | --- | --- |
| メールとパスワード | 既存のユーザーがそのまま使える | パスワードの再設定の問い合わせが増えるかもしれません |
| 外部アカウント | 入力の手間が少ない | 提供元の障害の影響を受けます |

\`\`\`css
.login-button:focus-visible { outline: 2px solid var(--r-accent); outline-offset: 2px; border-radius: 8px; }
\`\`\`

> 切り替えの間も、いまのログインは使えます。
`;

/** The phone, dark: a question written in Markdown; the table and the code scroll inside themselves. */
export const PhoneQuestionMarkdown: Story = {
  args: {
    variant: 'phone',
    initial: { tab: 'fromAi', openId: 'Q-13' },
    read: async (_projectId, id) => ({
      id,
      type: 'question',
      body: markdownBody,
      choices: [
        { id: 'mail', label: 'メールとパスワードだけ' },
        { id: 'sso', label: '外部アカウントも足す' },
      ],
      recommendedChoiceId: null,
      status: 'open',
      referencedBy: [14],
    }),
  },
  parameters: phone,
  globals: { locale: 'ja', mode: 'dark', width: 'phone-375' },
  play: async () => {
    const sheet = await page().findByRole('dialog', { name: 'メッセージ' });
    await within(sheet).findByRole('heading', { name: '認証方式の選び方' }, MARKDOWN_LOADED);
    const body = sheet.querySelector('.surface__body');
    if (!(body instanceof HTMLElement)) throw new Error('The sheet has no body.');
    // The sheet never scrolls sideways; wide blocks scroll inside themselves.
    await expect(body.scrollWidth).toBeLessThanOrEqual(body.clientWidth + 1);
  },
};

const TIME_WINDOW = /^\d\d\/\d\d \d\d:\d\d–/;

/** The Summary tab on the PC: the count, the windows with `#id title`, and a trash button at the right end of each heading. */
export const SummaryTabDesktop: Story = {
  args: { initial: { tab: 'summary' }, summaries: { dismiss: fn(async () => undefined) } },
  play: async ({ args }) => {
    const list = await page().findByRole('dialog', { name: 'メッセージ' });
    await expect(within(list).getAllByRole('tab')).toHaveLength(3);
    const tab = within(list).getByRole('tab', { name: /サマリー/ });
    await waitFor(() => expect(tab).toHaveTextContent('4'));
    await expect(await within(list).findByText('#552')).toBeInTheDocument();
    await expect(within(list).getAllByText(TIME_WINDOW)).toHaveLength(4);
    await expect(within(list).getByText('#552')).toBeInTheDocument();
    const trash = within(list).getAllByRole('button', { name: 'このサマリーを削除' });
    await expect(trash).toHaveLength(4);
    await userEvent.click(trash[0] as HTMLElement);
    await waitFor(() => expect(within(list).getAllByText(TIME_WINDOW)).toHaveLength(3));
    await expect(tab).toHaveTextContent('3');
    await expect(args.summaries?.dismiss).toHaveBeenCalledWith(SAMPLE_PROJECT, expect.any(String));
  },
};

/**
 * Each result of a summary is a link row (card row, chevron, "成果 vN") to the task's Results tab:
 * a real link the keyboard reaches, named by its task and version. A line without a version
 * (task 549) opens the tab with no highlight and shows no version.
 */
export const SummaryResultLinks: Story = {
  args: { initial: { tab: 'summary' }, summaries: { dismiss: fn(async () => undefined) } },
  play: async () => {
    const list = await page().findByRole('dialog', { name: 'メッセージ' });
    const link = await within(list).findByRole('link', {
      name: /^タスク #552 の成果 v2 を開く: /,
    });
    await expect(link).toHaveAttribute('href', `?project=${SAMPLE_PROJECT}&task=552&result=2`);
    await expect(link).toHaveTextContent('成果 v2');
    const old = within(list).getByRole('link', { name: /^タスク #549 の成果を開く: / });
    await expect(old).toHaveAttribute('href', `?project=${SAMPLE_PROJECT}&task=549&tab=results`);
    link.focus();
    await expect(link).toHaveFocus();
  },
};

/** No summaries yet: the tab counts 0 and says what will appear. */
export const SummaryTabEmpty: Story = {
  args: {
    initial: { tab: 'summary' },
    summaries: { dismiss: fn(async () => undefined), none: true },
  },
  globals: { locale: 'en' },
  play: async () => {
    const list = await page().findByRole('dialog', { name: 'Messages' });
    await expect(await within(list).findByText('No summaries yet')).toBeInTheDocument();
    await expect(within(list).getByRole('tab', { name: /Summary/ })).toHaveTextContent('0');
  },
};

/** A dismissal the server refuses brings the summary back and says so. */
export const SummaryDismissFails: Story = {
  args: {
    initial: { tab: 'summary' },
    summaries: {
      dismiss: fn(async () => {
        throw new Error('no');
      }),
    },
  },
  play: async () => {
    const list = await page().findByRole('dialog', { name: 'メッセージ' });
    const trash = await within(list).findAllByRole('button', { name: 'このサマリーを削除' });
    await userEvent.click(trash[0] as HTMLElement);
    await expect(await within(list).findByRole('alert')).toHaveTextContent('削除できませんでした');
    await waitFor(() => expect(within(list).getAllByText(TIME_WINDOW)).toHaveLength(4));
  },
};

/** The result link rows on a phone: the whole row is the tap target, with the version under the title. */
export const SummaryResultLinksPhone: Story = {
  args: {
    variant: 'phone',
    initial: { tab: 'summary' },
    summaries: { dismiss: fn(async () => undefined) },
  },
  parameters: phone,
  globals: { locale: 'ja', width: 'phone-375' },
  play: async () => {
    const sheet = await page().findByRole('dialog', { name: 'メッセージ' });
    const link = await within(sheet).findByRole('link', {
      name: /^タスク #552 の成果 v2 を開く: /,
    });
    await expect(link).toHaveAttribute('href', `?project=${SAMPLE_PROJECT}&task=552&result=2`);
  },
};

/** The Summary tab on a phone: a tap on an item shows the trash tile on its right; tapping the tile dismisses. */
export const SummaryTabPhone: Story = {
  args: {
    variant: 'phone',
    initial: { tab: 'summary' },
    summaries: { dismiss: fn(async () => undefined) },
  },
  parameters: phone,
  globals: { locale: 'ja', width: 'phone-375' },
  play: async ({ args }) => {
    const sheet = await page().findByRole('dialog', { name: 'メッセージ' });
    const first = (await within(sheet).findAllByText(TIME_WINDOW))[0] as HTMLElement;
    await userEvent.click(first);
    const tile = await within(sheet).findByRole('button', { name: 'このサマリーを削除' });
    await userEvent.click(tile);
    await waitFor(() => expect(within(sheet).getAllByText(TIME_WINDOW)).toHaveLength(3));
    await expect(args.summaries?.dismiss).toHaveBeenCalledTimes(1);
  },
};

/** A finger on `target`, as a touch event. The list watches touch events for the pull. */
function touch(
  type: 'touchstart' | 'touchmove' | 'touchend',
  target: Element,
  x: number,
  y: number,
) {
  const point = new Touch({ identifier: 1, target, clientX: x, clientY: y });
  target.dispatchEvent(
    new TouchEvent(type, {
      bubbles: true,
      cancelable: true,
      touches: type === 'touchend' ? [] : [point],
      changedTouches: [point],
    }),
  );
}

/** Pulling the phone list down from its top: the hint reads "ひっぱって更新", as on the lanes. */
export const PhonePullToRefresh: Story = {
  args: { variant: 'phone', initial: { tab: 'fromAi' }, previewPull: 'pulling' },
  parameters: phone,
  globals: { locale: 'ja', width: 'phone-390' },
  play: async () => {
    await expect(await page().findByText('ひっぱって更新')).toBeVisible();
  },
};

/** Pulled far enough: the arrow turns over and a release will refresh. */
export const PhonePullReady: Story = {
  args: { variant: 'phone', initial: { tab: 'fromAi' }, previewPull: 'ready' },
  parameters: phone,
  globals: { locale: 'ja', width: 'phone-390' },
  play: async () => {
    await expect(await page().findByText('指をはなして更新')).toBeVisible();
  },
};

/** Refreshing: a spinner above the rows. */
export const PhoneRefreshing: Story = {
  args: { variant: 'phone', initial: { tab: 'fromAi' }, previewPull: 'refreshing' },
  parameters: phone,
  globals: { locale: 'ja', width: 'phone-390' },
  play: async () => {
    await expect(await page().findByText('更新中…')).toBeInTheDocument();
  },
};

/** A long pull from the top of the phone list refreshes on release; a short one does not. */
export const PhonePullGesture: Story = {
  args: { variant: 'phone', initial: { tab: 'fromAi' }, onRefresh: fn() },
  parameters: phone,
  globals: { locale: 'ja', width: 'phone-390' },
  play: async ({ args }) => {
    const sheet = await page().findByRole('dialog', { name: 'メッセージ' });
    const row = (await within(sheet).findAllByRole('button', { name: /Q-/ }))[0] as HTMLElement;
    const y = row.getBoundingClientRect().top + 10;
    touch('touchstart', row, 100, y);
    touch('touchmove', row, 100, y + 30);
    touch('touchmove', row, 100, y + 50);
    touch('touchend', row, 100, y + 50);
    await expect(args.onRefresh).not.toHaveBeenCalled();
    touch('touchstart', row, 100, y);
    touch('touchmove', row, 100, y + 40);
    touch('touchmove', row, 100, y + 120);
    await expect(await within(sheet).findByText('指をはなして更新')).toBeVisible();
    touch('touchend', row, 100, y + 120);
    await expect(args.onRefresh).toHaveBeenCalledOnce();
  },
};

/** A sideways drag is left to the tab swipe and never pulls. */
export const PhoneSidewaysIsNotAPull: Story = {
  args: { variant: 'phone', initial: { tab: 'fromAi' }, onRefresh: fn() },
  parameters: phone,
  globals: { locale: 'ja', width: 'phone-390' },
  play: async ({ args }) => {
    const sheet = await page().findByRole('dialog', { name: 'メッセージ' });
    const row = (await within(sheet).findAllByRole('button', { name: /Q-/ }))[0] as HTMLElement;
    const y = row.getBoundingClientRect().top + 10;
    touch('touchstart', row, 200, y);
    touch('touchmove', row, 120, y + 10);
    touch('touchmove', row, 40, y + 60);
    touch('touchend', row, 40, y + 60);
    await expect(args.onRefresh).not.toHaveBeenCalled();
    await expect(sheet.querySelector('.monitor-pull')).toBeNull();
  },
};

/** A pointer press that moves from `from` to `to`, one frame apart, as a finger on a card does. */
async function pointerSwipe(
  target: Element,
  from: number,
  to: number,
  y: number,
  /** Runs while the finger is still down. */
  during?: () => Promise<void>,
) {
  let time = 1000;
  const fire = (type: string, x: number, buttons: number) => {
    const event = new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      isPrimary: true,
      pointerId: 7,
      pointerType: 'touch',
      button: 0,
      buttons,
      clientX: x,
      clientY: y,
    });
    time += 16;
    Object.defineProperty(event, 'timeStamp', { value: time });
    target.dispatchEvent(event);
  };
  fire('pointerdown', from, 1);
  fire('pointermove', from + (to - from) / 2, 1);
  fire('pointermove', to, 1);
  await during?.();
  fire('pointerup', to, 0);
}

/**
 * The Summary tab on a phone: a swipe to the right on an item does not start the card's swipe (the
 * tiles stay shut and no item slides), and a swipe to the left still shows the trash tile.
 */
export const SummaryCardSwipeLeftOnly: Story = {
  args: {
    variant: 'phone',
    initial: { tab: 'summary' },
    summaries: { dismiss: fn(async () => undefined) },
  },
  parameters: phone,
  globals: { locale: 'ja', width: 'phone-375' },
  play: async () => {
    const sheet = await page().findByRole('dialog', { name: 'メッセージ' });
    const first = (await within(sheet).findAllByText(TIME_WINDOW))[0] as HTMLElement;
    const card = first.closest('.swipe-card');
    if (!card) throw new Error('The summary is not a swipe card.');
    const rect = card.getBoundingClientRect();
    const y = rect.top + 20;
    // While the finger is down on a rightward swipe the card does not take the press.
    await pointerSwipe(card, rect.left + 40, rect.left + 200, y, async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      await expect(card).not.toHaveAttribute('data-dragging');
    });
    await expect(card.closest('li')).not.toHaveAttribute('data-revealed');
    // A leftward swipe does take it.
    await pointerSwipe(card, rect.right - 20, rect.left + 40, y, async () => {
      await waitFor(() => expect(card).toHaveAttribute('data-dragging', 'true'));
    });
    await waitFor(() => expect(card.closest('li')).toHaveAttribute('data-revealed', 'true'));
    await expect(
      await within(sheet).findByRole('button', { name: 'このサマリーを削除' }),
    ).toBeVisible();
  },
};
