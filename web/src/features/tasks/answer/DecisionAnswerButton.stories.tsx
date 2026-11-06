import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { DecisionAnswerButton, decisionAnswerButtonSelector } from './DecisionAnswerButton';

const meta = {
  title: 'Task/Answer/DecisionAnswerButton',
  component: DecisionAnswerButton,
  args: { continuing: false, onClick: fn(), taskId: 11 },
  decorators: [
    (Story) => (
      <div style={{ width: 228, padding: 8, background: 'var(--r-pend-bg)' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof DecisionAnswerButton>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The only control of a card that waits for an answer. */
export const Open: Story = {
  play: async ({ args, canvasElement }) => {
    const button = within(canvasElement).getByRole('button', { name: 'Answer the question' });
    await expect(button).toHaveAttribute('data-task-id', '11');
    await expect(canvasElement.querySelector(decisionAnswerButtonSelector(11))).toBe(button);
    await userEvent.click(button);
    await expect(args.onClick).toHaveBeenCalledTimes(1);
  },
};

/** An answer is already started: the button says so, in the outline. */
export const Continuing: Story = {
  args: { continuing: true },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('button', { name: 'Continue answering' }),
    ).toHaveAttribute('data-variant', 'outline');
  },
};

/** On the phone the button fills the card. */
export const MonitorCard: Story = {
  parameters: { storyFrame: 'monitor' },
  globals: { width: 'phone-390' },
  decorators: [
    (Story) => (
      <div style={{ width: 358, padding: 12, background: 'var(--r-pend-bg)' }}>
        <Story />
      </div>
    ),
  ],
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('button', { name: 'Answer the question' }),
    ).toBeVisible();
  },
};
