import type { Meta, StoryObj } from '@storybook/react-vite';
import { useTranslation } from 'react-i18next';
import { expect, fn, userEvent, within } from 'storybook/test';
import { QuestionBand } from './QuestionBand';
import { sampleQuestions } from './questionSamples';

interface HarnessProps {
  /** How many questions there are; 0 shows the header alone. */
  count: number;
  /** How many of the first questions have an answer held. */
  held: number;
  variant: 'board' | 'phone';
  onOpen: (questionId: string) => void;
  onAnswer: () => void;
  onReview: () => void;
}

/** The band with the sample questions, at the width the board or the monitor gives it. */
function Harness({ count, held, variant, ...handlers }: HarnessProps) {
  const { i18n } = useTranslation();
  const questions = sampleQuestions(i18n.language).slice(0, count);
  return (
    <div style={{ padding: variant === 'board' ? 24 : 8 }}>
      <QuestionBand
        questions={questions}
        held={new Set(questions.slice(0, held).map((question) => question.id))}
        sendableCount={Math.min(held, count)}
        variant={variant}
        {...handlers}
      />
    </div>
  );
}

/** Opens the band by pressing its header, as a user does; it starts closed. */
async function expand(canvasElement: HTMLElement) {
  await userEvent.click(
    within(canvasElement).getByRole('button', { name: /^未回答の質問を表示する/ }),
  );
}

const meta = {
  title: 'Task/Answer/QuestionBand',
  component: Harness,
  args: { count: 5, held: 0, variant: 'board', onOpen: fn(), onAnswer: fn(), onReview: fn() },
  parameters: { layout: 'fullscreen' },
  globals: { locale: 'ja' },
} satisfies Meta<typeof Harness>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Five questions: closed at first, with the count and the answer button in the header; the header opens the list. */
export const Items: Story = {
  play: async ({ args, canvasElement }) => {
    const band = within(canvasElement).getByRole('region', { name: '未回答の質問' });
    const toggle = within(band).getByRole('button', { name: /^未回答の質問を表示する/ });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(within(band).getByText('5')).toBeVisible();
    await expect(within(band).queryAllByRole('listitem')).toHaveLength(0);
    await expect(within(band).getByRole('button', { name: 'まとめて答える' })).toBeVisible();
    await expect(within(band).queryByRole('button', { name: '次の質問を表示' })).toBeNull();
    await userEvent.click(toggle);
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(within(band).getAllByRole('listitem')).toHaveLength(5);
    await expect(within(band).getByText('タスクなし')).toBeInTheDocument();
    await expect(within(band).getByText('#14 #15 #16')).toBeInTheDocument();
    await userEvent.click(within(band).getByRole('button', { name: /破壊的変更の扱い/ }));
    await expect(args.onOpen).toHaveBeenCalledWith('Q-2');
    await userEvent.click(within(band).getByRole('button', { name: 'まとめて答える' }));
    await expect(args.onAnswer).toHaveBeenCalledTimes(1);
    await userEvent.click(within(band).getByRole('button', { name: /^未回答の質問を隠す/ }));
    await expect(within(band).queryAllByRole('listitem')).toHaveLength(0);
  },
};

/** The band after its header is pressed: the questions and the scroll buttons show. */
export const Expanded: Story = {
  play: async ({ canvasElement }) => {
    await expand(canvasElement);
    const band = within(canvasElement);
    await expect(band.getAllByRole('listitem')).toHaveLength(5);
    await expect(band.getByRole('button', { name: '次の質問を表示' })).toBeVisible();
  },
};

/** Two answers held: they are marked, and the header offers to go on or to send. */
export const Held: Story = {
  args: { held: 2 },
  play: async ({ args, canvasElement }) => {
    await expand(canvasElement);
    const band = within(canvasElement);
    await expect(band.getByText('2 件に回答済み・まだ送っていません')).toBeInTheDocument();
    await expect(band.getAllByText('回答済み・未送信')).toHaveLength(2);
    await userEvent.click(band.getByRole('button', { name: '続きから答える' }));
    await expect(args.onAnswer).toHaveBeenCalledTimes(1);
    await userEvent.click(band.getByRole('button', { name: '確認して送る' }));
    await expect(args.onReview).toHaveBeenCalledTimes(1);
  },
};

/** A long title stops at two lines; every item keeps the same size. */
export const LongTitle: Story = {
  play: async ({ canvasElement }) => {
    await expand(canvasElement);
    const items = [...canvasElement.querySelectorAll<HTMLElement>('.question-band__item')];
    const sizes = new Set(items.map((item) => `${item.offsetWidth}x${item.offsetHeight}`));
    await expect([...sizes]).toEqual(['250x78']);
    const long = items[2]?.querySelector<HTMLElement>('.question-band__text');
    await expect(long && long.scrollHeight > long.clientHeight).toBe(true);
  },
};

/** No questions: the header still shows with a count of 0, the toggle does nothing, and no list shows. */
export const Empty: Story = {
  args: { count: 0 },
  play: async ({ canvasElement }) => {
    const band = within(canvasElement).getByRole('region', { name: '未回答の質問' });
    await expect(within(band).getByText('0')).toBeVisible();
    const toggle = within(band).getByRole('button', { name: /^未回答の質問を表示する/ });
    await expect(toggle).toBeDisabled();
    await expect(within(band).queryByRole('list')).toBeNull();
    await expect(within(band).queryByRole('status')).toBeNull();
    await expect(within(band).getAllByRole('button')).toHaveLength(1);
  },
};

/** The band in English. */
export const English: Story = {
  args: { held: 2 },
  globals: { locale: 'en' },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('button', { name: 'Review and send' }),
    ).toBeInTheDocument();
  },
};

/** Dark mode takes only the existing tokens. */
export const Dark: Story = {
  args: { held: 2 },
  globals: { locale: 'ja', mode: 'dark' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('region')).toBeVisible();
  },
};

/** The monitor's band: closed at first; opened, narrower items, no scroll buttons, one button. */
export const Phone: Story = {
  args: { variant: 'phone' },
  parameters: { storyFrame: 'monitor' },
  globals: { locale: 'ja', width: 'phone-375' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryAllByRole('listitem')).toHaveLength(0);
    await expand(canvasElement);
    const item = canvasElement.querySelector<HTMLElement>('.question-band__item');
    await expect(item?.offsetWidth).toBe(210);
    await expect(
      within(canvasElement).queryByRole('button', { name: '次の質問を表示' }),
    ).toBeNull();
    await expect(
      within(canvasElement).getByRole('button', { name: 'まとめて答える' }),
    ).toBeInTheDocument();
  },
};

/** The monitor's band with answers held: the review is the one button. */
export const PhoneHeld: Story = {
  args: { variant: 'phone', held: 2 },
  parameters: { storyFrame: 'monitor' },
  globals: { locale: 'ja', width: 'phone-375' },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('button', { name: '確認して送る' }),
    ).toBeInTheDocument();
    await expect(
      within(canvasElement).queryByRole('button', { name: '続きから答える' }),
    ).toBeNull();
  },
};

/** The monitor with no questions: the band stays, with a count of 0 and nothing to open. */
export const PhoneEmpty: Story = {
  args: { variant: 'phone', count: 0 },
  parameters: { storyFrame: 'monitor' },
  globals: { locale: 'ja', width: 'phone-375' },
  play: async ({ canvasElement }) => {
    const band = within(canvasElement).getByRole('region', { name: '未回答の質問' });
    await expect(within(band).getByText('0')).toBeVisible();
    await expect(within(band).getByRole('button')).toBeDisabled();
  },
};

/** The monitor's band in dark mode. */
export const PhoneDark: Story = {
  args: { variant: 'phone' },
  parameters: { storyFrame: 'monitor' },
  globals: { locale: 'ja', mode: 'dark', width: 'phone-375' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('region')).toBeVisible();
  },
};

/** The monitor's band after its header is pressed. */
export const PhoneExpanded: Story = {
  args: { variant: 'phone' },
  parameters: { storyFrame: 'monitor' },
  globals: { locale: 'ja', width: 'phone-375' },
  play: async ({ canvasElement }) => {
    await expand(canvasElement);
    await expect(within(canvasElement).getAllByRole('listitem')).toHaveLength(5);
  },
};
