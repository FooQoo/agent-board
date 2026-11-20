import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { SummaryScreen } from './SummaryScreen';

// The message center on a PC with a new "Summary" tab next to the questions and requests.
// Static data, no product behavior.
const meta = {
  title: 'Mocks/Summary/Desktop',
  component: SummaryScreen,
  args: { variant: 'desktop' },
  parameters: { layout: 'fullscreen' },
  globals: { width: 'desktop' },
} satisfies Meta<typeof SummaryScreen>;
export default meta;
type Story = StoryObj<typeof meta>;

/** No summaries yet: the tab shows 0 and says what will appear. */
export const Empty: Story = {
  args: { set: 'empty' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getAllByRole('tab')).toHaveLength(3);
    await expect(
      within(canvasElement).getByText(/サマリーはまだありません|No summaries yet/),
    ).toBeVisible();
  },
};

/** Two unread (tinted, dotted, badge) above two read; the unread count sits inside the Summary tab only. */
export const UnreadMixed: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.getAllByText(/^(未読|Unread)$/)).toHaveLength(2);
    await expect(c.getByText('#552')).toBeVisible();
  },
};

/** One window with twelve results, long titles wrap inside the row. */
export const LongList: Story = {
  args: { set: 'long' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getAllByText(/^#5\d\d$/).length).toBeGreaterThan(10);
  },
};

/** The trash button is shown at the right edge (here already opened; on a PC hover or focus shows it too). */
export const TrashRevealed: Story = {
  args: { revealedId: 's1' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button', { name: /削除|Delete/ })).toBeVisible();
  },
};

/** Opening an unread item marks it read (the tab count drops) and shows the trash button. */
export const OpenMarksRead: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    const [first] = c.getAllByRole('button', { name: /09:00–10:00/ });
    if (first) await userEvent.click(first);
    await expect(c.getAllByText(/^(未読|Unread)$/)).toHaveLength(1);
  },
};
