import type { Meta, StoryObj } from '@storybook/react-vite';
import { useTranslation } from 'react-i18next';
import { expect, fn, userEvent, within } from 'storybook/test';
import { modalDocsParameters } from '../../../../.storybook/support/modal-docs';
import { MarkdownView } from '../../../shared/markdown/MarkdownView';
import { PlanReview, type PlanReviewProps } from './PlanReview';
import type { Plan } from './model/plan';
import { addedPlan, newEpicPlan, sampleEpic, singlePlan } from './planSamples';

type Shape = 'newBlocked' | 'new' | 'added' | 'single';

interface HarnessProps
  extends Pick<
    PlanReviewProps,
    'kind' | 'starting' | 'error' | 'onClose' | 'onStart' | 'onOpenQuestion'
  > {
  shape: Shape;
}

/** The review of one of the sample plans; a new epic shows the goal of its sample document. */
function Harness({ shape, ...rest }: HarnessProps) {
  const { i18n } = useTranslation();
  const language = i18n.language;
  const plan: Plan =
    shape === 'new'
      ? newEpicPlan(language, true)
      : shape === 'newBlocked'
        ? newEpicPlan(language)
        : shape === 'added'
          ? addedPlan(language)
          : singlePlan(language);
  const goal = plan.kind === 'new' ? <MarkdownView source={sampleEpic(language).body} /> : null;
  return <PlanReview {...rest} plan={plan} goal={goal} />;
}

const meta = {
  title: 'Task/Plans/PlanReview',
  component: Harness,
  args: {
    shape: 'newBlocked',
    kind: 'dialog',
    onClose: fn(),
    onStart: fn(),
    onOpenQuestion: fn(),
  },
  parameters: { layout: 'fullscreen', ...modalDocsParameters },
  globals: { locale: 'ja' },
} satisfies Meta<typeof Harness>;

export default meta;
type Story = StoryObj<typeof meta>;

const page = () => within(document.body);
const phone = { locale: 'ja', width: 'phone-375' } as const;
const phoneParameters = { storyFrame: 'monitor', layout: 'fullscreen', ...modalDocsParameters };

/** A question is open: the start button is disabled and says why, and the question has its own button. */
export const WithOpenQuestion: Story = {
  play: async ({ args }) => {
    await expect(await page().findByRole('dialog', { name: '計画のレビュー' })).toBeInTheDocument();
    await expect(page().getByRole('button', { name: 'この計画で始める' })).toBeDisabled();
    await expect(page().getByRole('note')).toHaveTextContent(
      '未回答の質問に答えると開始できます。',
    );
    await expect(page().getByText('始まるタスク(この順に始まります)')).toBeInTheDocument();
    await userEvent.click(page().getByRole('button', { name: '質問に答える' }));
    await expect(args.onOpenQuestion).toHaveBeenCalledWith('Q-12');
  },
};

/** No question is open: the goal and the tasks, and the plan starts from the button. */
export const Ready: Story = {
  args: { shape: 'new' },
  play: async ({ args }) => {
    await expect(await page().findByText('ゴール')).toBeInTheDocument();
    await expect(page().getByText(/メールのリンク/, { selector: 'p' })).toBeInTheDocument();
    await userEvent.click(page().getByRole('button', { name: 'この計画で始める' }));
    await expect(args.onStart).toHaveBeenCalledOnce();
  },
};

/** 「あとでやる」 only closes. */
export const Later: Story = {
  args: { shape: 'new' },
  play: async ({ args }) => {
    await userEvent.click(await page().findByRole('button', { name: 'あとでやる' }));
    await expect(args.onClose).toHaveBeenCalledOnce();
    await expect(args.onStart).not.toHaveBeenCalled();
  },
};

/** Tasks added to a running epic: no goal, and the scope says only the added tasks start. */
export const AddedTasks: Story = {
  args: { shape: 'added' },
  play: async () => {
    await expect(await page().findByText(/追加されたタスクだけ/)).toBeInTheDocument();
    await expect(page().queryByText('ゴール')).not.toBeInTheDocument();
  },
};

/** A single task has no numbering and no order wording. */
export const SingleTask: Story = {
  args: { shape: 'single' },
  globals: { locale: 'en' },
  play: async () => {
    await expect(await page().findByText('Task that will start')).toBeInTheDocument();
    await expect(page().queryByText(/in this order/)).not.toBeInTheDocument();
    await expect(page().queryByText('1', { selector: '.plan-review__no' })).not.toBeInTheDocument();
  },
};

/** The start is on its way: both buttons wait. */
export const Starting: Story = {
  args: { shape: 'new', starting: true },
  play: async () => {
    await expect(await page().findByRole('button', { name: '開始しています' })).toBeDisabled();
    await expect(page().getByRole('button', { name: 'あとでやる' })).toBeDisabled();
  },
};

/** The server refused the start because a question came in: the reason is shown above the buttons. */
export const RefusedByQuestion: Story = {
  args: { shape: 'new', error: 'Q-14 was just asked.' },
  globals: { locale: 'en' },
  play: async () => {
    await expect(await page().findByRole('note')).toHaveTextContent('Q-14 was just asked.');
  },
};

/** The same review in English and dark. */
export const EnglishDark: Story = {
  globals: { locale: 'en', mode: 'dark' },
  play: async () => {
    await expect(
      await page().findByRole('dialog', { name: 'Review the plan' }),
    ).toBeInTheDocument();
    await expect(page().getByRole('button', { name: 'Start with this plan' })).toBeDisabled();
  },
};

/** On a phone the review is a bottom sheet with a question open. */
export const SheetWithOpenQuestion: Story = {
  args: { kind: 'sheet' },
  parameters: phoneParameters,
  globals: phone,
  play: async () => {
    await expect(await page().findByRole('dialog', { name: '計画のレビュー' })).toBeInTheDocument();
    await expect(page().getByRole('button', { name: 'この計画で始める' })).toBeDisabled();
  },
};

/** The sheet, ready to start. */
export const SheetReady: Story = {
  args: { kind: 'sheet', shape: 'new' },
  parameters: phoneParameters,
  globals: phone,
  play: async () => {
    await expect(await page().findByRole('button', { name: 'この計画で始める' })).toBeEnabled();
  },
};

/** The sheet of a single task. */
export const SheetSingleTask: Story = {
  args: { kind: 'sheet', shape: 'single' },
  parameters: phoneParameters,
  globals: phone,
};

/** The sheet in English and dark. */
export const SheetEnglishDark: Story = {
  args: { kind: 'sheet' },
  parameters: phoneParameters,
  globals: { locale: 'en', mode: 'dark', width: 'phone-375' },
};
