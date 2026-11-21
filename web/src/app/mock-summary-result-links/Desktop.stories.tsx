import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { SummaryResultLinksScreen } from './SummaryResultLinksScreen';

// The Summary tab on a PC: result lines that read as links, three treatments. Static data.
const meta = {
  title: 'Mocks/SummaryResultLinks/Desktop',
  component: SummaryResultLinksScreen,
  args: { variant: 'desktop', option: 'underline' },
  parameters: { layout: 'fullscreen' },
  globals: { width: 'desktop' },
} satisfies Meta<typeof SummaryResultLinksScreen>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Option A: the title is an underlined accent link with an arrow. Click one to see where it leads. */
export const UnderlineArrow: Story = {
  args: { option: 'underline' },
  play: async ({ canvasElement }) => {
    const links = within(canvasElement).getAllByRole('link');
    await expect(links).toHaveLength(5);
  },
};

/** Following a link (click) leads to the results of that task. */
export const FollowLink: Story = {
  play: async ({ canvasElement }) => {
    const links = within(canvasElement).getAllByRole('link');
    await userEvent.click(links[0] as HTMLElement);
    await expect(
      within(canvasElement).getByRole('button', { name: /一覧へ戻る|Back to the list/ }),
    ).toBeVisible();
  },
};

/** Option B: each result is a card-style row with a chevron and hover and press states. */
export const CardRow: Story = {
  args: { option: 'row' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getAllByRole('link')).toHaveLength(5);
  },
};

/** Option C: a thumbnail of the result picture, then the title and the version. */
export const Thumbnail: Story = {
  args: { option: 'thumb' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getAllByRole('link')).toHaveLength(5);
  },
};

/** Where a result leads: the task's results, scrolled to and highlighting the linked version. */
export const Destination: Story = {
  args: { opened: { taskId: 552, version: 2 } },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('[data-focused="true"]')).not.toBeNull();
  },
};
