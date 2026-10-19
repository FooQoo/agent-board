import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { makeTask } from '../../../../.storybook/support/fixtures';
import { AcceptanceProgress } from './AcceptanceProgress';

const meta = {
  title: 'Task/Acceptance/AcceptanceProgress',
  component: AcceptanceProgress,
  args: { task: makeTask({ id: 1 }) },
} satisfies Meta<typeof AcceptanceProgress>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A card without conditions shows nothing. */
export const NoConditions: Story = {
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('.acceptance-chip')).toBeNull();
  },
};

export const Partial: Story = {
  args: {
    task: makeTask({
      id: 2,
      acceptance: [
        { id: 'a1', text: 'Parser handles empty input', done: true },
        { id: 'a2', text: 'Errors are shown in the dialog', done: false },
      ],
    }),
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('1/2')).toBeInTheDocument();
  },
};

export const Complete: Story = {
  args: {
    task: makeTask({
      id: 3,
      acceptance: [{ id: 'a1', text: 'Parser handles empty input', done: true }],
    }),
  },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('[data-complete="true"]')).not.toBeNull();
  },
};

/** Three of five conditions done: the chip the card shows, as the adopted board card has it. */
export const ThreeOfFive: Story = {
  args: {
    task: makeTask({
      id: 5,
      acceptance: [
        { id: 'a1', text: 'Parser handles empty input', done: true },
        { id: 'a2', text: 'Errors are shown in the dialog', done: true },
        { id: 'a3', text: 'Retry keeps the typed text', done: true },
        { id: 'a4', text: 'Saved order is kept', done: false },
        { id: 'a5', text: 'Locale switch updates the labels', done: false },
      ],
    }),
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('3/5')).toBeInTheDocument();
  },
};

/** The frontmatter cannot be read: the card says so instead of showing a count. */
export const Unreadable: Story = {
  args: { task: makeTask({ id: 4, acceptanceError: true }) },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('status')).toHaveTextContent('Unreadable');
  },
};
