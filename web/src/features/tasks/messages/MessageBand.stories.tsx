import type { Meta, StoryObj } from '@storybook/react-vite';
import { useTranslation } from 'react-i18next';
import { expect, fn, userEvent, within } from 'storybook/test';
import { MessageBand } from './MessageBand';
import { sampleMessages } from './messageSamples';

interface HarnessProps {
  /** `none`: nothing is open, so the band says 0. */
  open: 'all' | 'none' | 'requests';
  variant: 'board' | 'phone';
  onOpen: () => void;
  onAsk?: () => void;
}

/** The band with the sample messages, at the width the board or the monitor gives it. */
function Harness({ open, variant, ...handlers }: HarnessProps) {
  const { i18n } = useTranslation();
  const all = sampleMessages(i18n.language);
  const messages =
    open === 'none' ? [] : open === 'requests' ? all.filter((m) => m.from === 'human') : all;
  return (
    <div style={{ padding: variant === 'board' ? 24 : 8 }}>
      <MessageBand messages={messages} variant={variant} {...handlers} />
    </div>
  );
}

const meta = {
  title: 'Task/Messages/MessageBand',
  component: Harness,
  args: { open: 'all', variant: 'board', onOpen: fn() },
  parameters: { layout: 'fullscreen' },
  globals: { locale: 'ja' },
} satisfies Meta<typeof Harness>;

export default meta;
type Story = StoryObj<typeof meta>;

const phone = { storyFrame: 'monitor', layout: 'fullscreen' } as const;

/** Two questions wait on you, and one request is not picked up yet; the band shows only names and counts. */
export const Counts: Story = {
  play: async ({ args, canvasElement }) => {
    const band = within(canvasElement).getByRole('region', { name: 'メッセージ' });
    await expect(within(band).getByText(/AI の質問/)).toHaveTextContent('2');
    await expect(within(band).getByText(/あなたの依頼/)).toHaveTextContent('1');
    await expect(within(band).queryByText(/受け取り待ち/)).toBeNull();
    await expect(within(band).queryByRole('button', { name: 'AI に依頼' })).toBeNull();
    await userEvent.click(within(band).getByRole('button', { name: '質問・依頼を確認' }));
    await expect(args.onOpen).toHaveBeenCalledTimes(1);
    await expect(args.onOpen).toHaveBeenLastCalledWith();
  },
};

/** Pressing a count opens the list on that tab. */
export const CountsOpenTabs: Story = {
  play: async ({ args, canvasElement }) => {
    const band = within(canvasElement).getByRole('region', { name: 'メッセージ' });
    await userEvent.click(within(band).getByRole('button', { name: /AI の質問/ }));
    await expect(args.onOpen).toHaveBeenLastCalledWith('fromAi');
    await userEvent.click(within(band).getByRole('button', { name: /あなたの依頼/ }));
    await expect(args.onOpen).toHaveBeenLastCalledWith('fromYou');
    within(band)
      .getByRole('button', { name: /あなたの依頼/ })
      .focus();
    await userEvent.keyboard('{Enter}');
    await expect(args.onOpen).toHaveBeenCalledTimes(3);
  },
};

/** Nothing waits on you: the band stays with a count of 0. */
export const Empty: Story = {
  args: { open: 'none' },
  play: async ({ canvasElement }) => {
    const band = within(canvasElement).getByRole('region', { name: 'メッセージ' });
    await expect(within(band).getByText(/AI の質問/)).toHaveTextContent('0');
    await expect(within(band).getByRole('button', { name: '質問・依頼を確認' })).toBeVisible();
  },
};

/** Only your own requests are open; the AI asks nothing. */
export const RequestsOnly: Story = {
  args: { open: 'requests' },
  globals: { locale: 'en' },
  play: async ({ canvasElement }) => {
    const band = within(canvasElement).getByRole('region', { name: 'Messages' });
    await expect(within(band).getByText(/AI's questions/)).toHaveTextContent('0');
    await expect(within(band).getByText(/Your requests/)).toHaveTextContent('1');
  },
};

/** English, dark. */
export const CountsEnDark: Story = {
  globals: { locale: 'en', mode: 'dark' },
  play: async ({ canvasElement }) => {
    const band = within(canvasElement).getByRole('region', { name: 'Messages' });
    await expect(within(band).getByText(/AI's questions/)).toHaveTextContent('2');
  },
};

/** The phone band shows "Ask AI" beside "Check questions and requests" when the screen gives it. */
export const PhoneWithAsk: Story = {
  args: { variant: 'phone', onAsk: fn() },
  parameters: phone,
  globals: { locale: 'ja', width: 'phone-375' },
  play: async ({ args, canvasElement }) => {
    const band = within(canvasElement).getByRole('region', { name: 'メッセージ' });
    await userEvent.click(within(band).getByRole('button', { name: 'AI に依頼' }));
    await expect(args.onAsk).toHaveBeenCalledTimes(1);
    await expect(within(band).getByRole('button', { name: '質問・依頼を確認' })).toBeVisible();
  },
};

/** Without `onAsk` the phone band has only the list button. */
export const PhoneWithoutAsk: Story = {
  args: { variant: 'phone' },
  parameters: phone,
  globals: { locale: 'en', mode: 'dark', width: 'phone-375' },
  play: async ({ canvasElement }) => {
    const band = within(canvasElement).getByRole('region', { name: 'Messages' });
    await expect(within(band).queryByRole('button', { name: 'Ask AI' })).toBeNull();
  },
};
