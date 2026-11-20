import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
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

/** Four summaries, all alike; the count in the Summary tab is the number not dismissed. */
export const List: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.getAllByText(/^11\/\d\d /)).toHaveLength(4);
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
