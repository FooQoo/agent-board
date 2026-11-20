import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { SummaryScreen } from './SummaryScreen';

// The phone's Messages screen, reached from the bottom bar, with the new "Summary" tab.
// The bar's Messages badge counts questions only. Static data, no product behavior.
const meta = {
  title: 'Mocks/Summary/Phone',
  component: SummaryScreen,
  args: { variant: 'phone' },
  parameters: { storyFrame: 'monitor', layout: 'fullscreen' },
  globals: { width: 'phone-375' },
} satisfies Meta<typeof SummaryScreen>;
export default meta;
type Story = StoryObj<typeof meta>;

/** No summaries yet; the bar badge still shows the open questions. */
export const Empty: Story = {
  args: { set: 'empty' },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText(/サマリーはまだありません|No summaries yet/),
    ).toBeVisible();
  },
};

/** Unread items are tinted with a dot and a badge; the count is in the tab, not on the bar. */
export const UnreadMixed: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.getAllByText(/^(未読|Unread)$/)).toHaveLength(2);
    await expect(c.getByRole('navigation')).toBeVisible();
  },
};

/** One window with twelve results; titles wrap and the list scrolls above the bar. */
export const LongList: Story = {
  args: { set: 'long' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getAllByText(/^#5\d\d$/).length).toBeGreaterThan(10);
  },
};

/** The first item slid left to show the trash button on its right (swipe left or tap the item). */
export const SwipeRevealed: Story = {
  args: { revealedId: 's1' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button', { name: /削除|Delete/ })).toBeVisible();
  },
};
