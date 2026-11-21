import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { PullIndicator } from './PullIndicator';

const meta = {
  title: 'Shared/UI/PullIndicator',
  component: PullIndicator,
  args: { state: 'pulling', offset: 40 },
  globals: { locale: 'ja' },
  decorators: [
    (Story) => (
      <div style={{ padding: 16, maxWidth: 360 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PullIndicator>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The finger pulls: an arrow and "ひっぱって更新". The lanes and the messages list show the same. */
export const Pulling: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('ひっぱって更新')).toBeVisible();
  },
};

/** Pulled far enough: the arrow turns over and a release refreshes. */
export const Ready: Story = {
  args: { state: 'ready', offset: 60 },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('指をはなして更新')).toBeVisible();
  },
};

/** Refreshing: a spinner, read as "更新中…" by a screen reader. */
export const Refreshing: Story = {
  args: { state: 'refreshing', offset: 48 },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('status')).toHaveTextContent('更新中…');
  },
};

/** At rest nothing is drawn. */
export const Idle: Story = {
  args: { state: 'idle', offset: 0 },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('.monitor-pull')).toBeNull();
  },
};
