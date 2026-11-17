import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { modalDocsParameters } from '../../../../.storybook/support/modal-docs';
import { MessageCenter } from './MessageCenter';
import {
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
  onAsk?: () => void;
  onOpenApproval: () => void;
}

/** The band and the list it opens, over the sample messages. */
function Harness({ variant, initial, answer, withdraw, onAsk, onOpenApproval }: HarnessProps) {
  const { i18n } = useTranslation();
  const panel = useMessagesPanel();
  const messages = useMemo(() => sampleMessages(i18n.language), [i18n.language]);
  const api = useMemo(
    () => sampleMessagesApi(i18n.language, { answer, withdraw }),
    [i18n.language, answer, withdraw],
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
        onOpenApproval={onOpenApproval}
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
    onOpenApproval: fn(),
  },
  parameters: { layout: 'fullscreen', ...modalDocsParameters },
  globals: { locale: 'ja' },
} satisfies Meta<typeof Harness>;

export default meta;
type Story = StoryObj<typeof meta>;

const page = () => within(document.body);
const phone = { storyFrame: 'monitor', layout: 'fullscreen', ...modalDocsParameters } as const;

/** The list opens from the band; "AI の質問" shows the two questions and the approval, newest first. */
export const ListFromAi: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: '一覧を開く' }));
    const list = await page().findByRole('dialog', { name: 'メッセージ' });
    await expect(within(list).getAllByRole('tab')).toHaveLength(2);
    await expect(within(list).getAllByText('未回答')).toHaveLength(2);
    await expect(within(list).getByText('承認待ち')).toBeVisible();
    await expect(within(list).queryByText('受け取り待ち')).toBeNull();
  },
};

/** "あなたの依頼": a request that no agent picked up yet says so. */
export const ListFromYou: Story = {
  args: { initial: { tab: 'fromYou' } },
  play: async () => {
    const list = await page().findByRole('dialog', { name: 'メッセージ' });
    await expect(within(list).getByText('受け取り待ち')).toBeVisible();
    await expect(within(list).queryByText('未回答')).toBeNull();
  },
};

/** An approval row hands over to the plan review. */
export const ApprovalRow: Story = {
  args: { initial: { tab: 'fromAi' } },
  globals: { locale: 'en' },
  play: async ({ args }) => {
    const list = await page().findByRole('dialog', { name: 'Messages' });
    await userEvent.click(within(list).getByRole('button', { name: /LOGIN-1/ }));
    await expect(args.onOpenApproval).toHaveBeenCalledTimes(1);
  },
};

/** An open question: the question on the left, the answer on the right, the buttons pinned below. */
export const QuestionOpen: Story = {
  args: { initial: { tab: 'fromAi', openId: 'Q-12' } },
  play: async () => {
    const dialog = await page().findByRole('dialog', { name: 'メッセージ' });
    await within(dialog).findByRole('heading', { name: '既存のユーザーデータの扱い' });
    const send = within(dialog).getByRole('button', { name: '回答を送る' });
    await expect(send).toBeDisabled();
    await expect(within(dialog).getByRole('button', { name: 'あとでやる' })).toBeVisible();
    await expect(within(dialog).getByText(/返事があるまで #21 #22 は止まります/)).toBeVisible();
    const question = dialog.querySelector('.decision-panel__question');
    const answer = dialog.querySelector('.decision-panel__answer');
    if (!question || !answer) throw new Error('The panel has no two columns.');
    // Two columns on the PC: the answer sits to the right of the question.
    await expect(answer.getBoundingClientRect().left).toBeGreaterThanOrEqual(
      question.getBoundingClientRect().right - 1,
    );
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
    await expect(await within(sheet).findByRole('button', { name: 'Withdraw' })).toBeVisible();
  },
};
