import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, within } from 'storybook/test';
import { modalDocsParameters } from '../../../.storybook/support/modal-docs';
import { BoardHeader, ExchangesScreen } from './ExchangesScreen';

// A visual mock of the planned "exchanges" feature (SPEC 18_EXCHANGES). Static data, no product behavior.
const meta = {
  title: 'Mocks/Exchanges/Desktop',
  component: ExchangesScreen,
  parameters: { layout: 'fullscreen', ...modalDocsParameters },
} satisfies Meta<typeof ExchangesScreen>;
export default meta;
type Story = StoryObj<typeof meta>;

const page = () => within(document.body);

/** 1. The board header: the add-task button is now "Ask AI". */
export const Header: StoryObj<typeof BoardHeader> = {
  render: () => <BoardHeader onAsk={fn()} />,
  play: async () => {
    await expect(page().getByRole('button', { name: /Ask AI/ })).toBeInTheDocument();
  },
};

/** 2. The Ask AI dialog: Markdown text and images, with no epic selector and no manual creation. */
export const AskAiDialog: Story = {
  args: { initial: { kind: 'ask' } },
  play: async () => {
    await expect(await page().findByRole('dialog', { name: 'Ask AI' })).toBeInTheDocument();
  },
};

export const AskAiDialogFilled: Story = {
  args: {
    initial: {
      kind: 'ask',
      text: '## Forgotten password\n\nAdd a way back on the login screen for people who forgot their password.\n\n![](draft.png)',
      images: 2,
    },
  },
};

/** 3 and 5. The band replaces the unanswered-questions band; the new epic is one plan card on top of Todo. */
export const BandAndPlanCard: Story = {
  args: { scenario: 'newEpic' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('region', { name: 'Exchanges' })).toBeVisible();
    await expect(within(canvasElement).getByText('Review and start')).toBeVisible();
  },
};

/** 5. Tasks added to an existing epic: "N tasks added to LOGIN-1". */
export const PlanCardAddedToEpic: Story = { args: { scenario: 'added' } };

/** 5. Single AI-draft tasks with no epic: the draft mark and a Start action, disabled behind a question. */
export const SingleDraftTasks: Story = { args: { scenario: 'singleDraft' } };

/** 5. Every approval shape on one board. */
export const AllApprovals: Story = { args: { scenario: 'all' } };

/** 4. The panel, "AI's questions" tab: open questions and the approval. */
export const PanelAiQuestions: Story = {
  args: { initial: { kind: 'panel', tab: 'fromAi' } },
  play: async () => {
    await expect(await page().findByRole('dialog', { name: 'Exchanges' })).toBeInTheDocument();
  },
};

/** 4. The panel, "Your requests" tab: a request nobody picked up yet shows "Waiting to be picked up". */
export const PanelYourRequests: Story = { args: { initial: { kind: 'panel', tab: 'fromYou' } } };

/** 4. The panel, "done" tab. */
export const PanelDone: Story = { args: { initial: { kind: 'panel', tab: 'done' } } };

/** 4. An opened question shows the existing answer UI. */
export const PanelQuestionOpen: Story = {
  args: { initial: { kind: 'panel', tab: 'fromAi', openId: 'Q-12' } },
};

/** 4. An opened request: the sent text, and the AI's only reply is "accepted". */
export const PanelRequestOpen: Story = {
  args: { initial: { kind: 'panel', tab: 'fromYou', openId: 'Q-14' } },
};

/** 6. The plan review while a question is open: Start is disabled and says why. */
export const PlanReviewWithOpenQuestion: Story = {
  args: { scenario: 'newEpic', initial: { kind: 'review', planId: 'LOGIN-1' } },
  play: async () => {
    await expect(
      await page().findByRole('button', { name: 'Start with this plan' }),
    ).toBeDisabled();
    await expect(page().getByRole('note')).toBeInTheDocument();
  },
};

/** 6. The plan review after the question was answered: Start is enabled. */
export const PlanReviewReady: Story = {
  args: { scenario: 'newEpicReady', initial: { kind: 'review', planId: 'LOGIN-1' } },
  play: async () => {
    await expect(await page().findByRole('button', { name: 'Start with this plan' })).toBeEnabled();
  },
};

/** 6. The review of tasks added to a running epic. */
export const PlanReviewAddedTasks: Story = {
  args: { scenario: 'added', initial: { kind: 'review', planId: 'LOGIN-1' } },
};

/** 6. The review of a single AI-draft task. */
export const PlanReviewSingleTask: Story = {
  args: { scenario: 'singleDraft', initial: { kind: 'review', planId: '#31' } },
};

/** Japanese, dark mode, as in the design review. */
export const BoardJaDark: Story = {
  args: { scenario: 'all' },
  globals: { locale: 'ja', mode: 'dark' },
};
