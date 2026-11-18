import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { modalDocsParameters } from '../../../../.storybook/support/modal-docs';
import { MessageCenter } from './MessageCenter';
import {
  answeredSample,
  resolveSampleAttachment,
  SAMPLE_PROJECT,
  sampleMessages,
  sampleMessagesApi,
} from './messageSamples';
import { type MessagesPanelTarget, useMessagesPanel } from './useMessagesPanel';
import type { MessagesApi } from './model/messages';

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
    () => sampleMessagesApi(i18n.language, { answer, withdraw, ...(read ? { read } : {}) }),
    [i18n.language, answer, withdraw, read],
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
export const ListFromAi: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: '一覧を開く' }));
    const list = await page().findByRole('dialog', { name: 'メッセージ' });
    await expect(within(list).getAllByRole('tab')).toHaveLength(2);
    await expect(within(list).getAllByText('未回答')).toHaveLength(2);
    await expect(within(list).queryByText('受け取り待ち')).toBeNull();
  },
};

/** "あなたの依頼": a request that no agent picked up yet says so. */
export const ListFromYou: Story = {
  args: { initial: { tab: 'fromYou' } },
  play: async () => {
    const list = await page().findByRole('dialog', { name: 'メッセージ' });
    await expect(within(list).getByText('受け取り待ち')).toBeInTheDocument();
    await expect(within(list).queryByText('未回答')).toBeNull();
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
    await within(dialog).findByRole('heading', { name: '既存のユーザーデータの扱い' });
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
    await within(list).findByRole('heading', { name: 'ログイン画面の文言' });
    const answer = within(list).getByRole('region', { name: 'あなたの回答' });
    await expect(answer).toHaveTextContent('変えてよい — ボタンの色はそのままで。');
    await expect(within(list).queryByRole('button', { name: '回答を送る' })).toBeNull();
    await expect(within(list).queryByRole('radio')).toBeNull();
  },
};

/** A question with choices needs a choice; a note alone cannot be sent. */
export const QuestionNeedsChoice: Story = {
  args: { initial: { tab: 'fromAi', openId: 'Q-13' } },
  globals: { locale: 'en', mode: 'dark' },
  play: async ({ args }) => {
    const dialog = await page().findByRole('dialog', { name: 'Messages' });
    const send = await within(dialog).findByRole('button', { name: 'Send answer' });
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Note' }), 'Not sure');
    await expect(send).toBeDisabled();
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Email and password only' }));
    await expect(send).toBeEnabled();
    await userEvent.click(send);
    await waitFor(() =>
      expect(args.answer).toHaveBeenCalledWith(SAMPLE_PROJECT, [
        { questionId: 'Q-13', choiceId: 'mail', text: 'Not sure' },
      ]),
    );
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

/** The phone: the band with "AI に依頼" and "一覧を開く". */
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
