import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { NavShadcnScreen } from './NavShadcnScreen';

// Five phone bottom bars over the same board: the product bar today, and three shadcn-style
// variants. Switch Language, Mode, and Width in the toolbar.
const meta = {
  title: 'Mocks/NavShadcn/Phone',
  component: NavShadcnScreen,
  args: { variant: 'current' },
  parameters: { storyFrame: 'monitor', layout: 'fullscreen' },
  globals: { width: 'phone-375' },
} satisfies Meta<typeof NavShadcnScreen>;
export default meta;
type Story = StoryObj<typeof meta>;

const bar = ({ canvasElement }: { canvasElement: HTMLElement }) =>
  within(canvasElement).getByRole('navigation');

/** The bar in the product today, for comparison: accent-colored, 14px pill, loud badge. */
export const Current: Story = {
  play: async (context) => {
    await expect(bar(context)).toBeVisible();
  },
};

/** A. Flat bar with a top hairline; the open item sits on a muted pill; destructive badge. */
export const VariantA: Story = {
  args: { variant: 'a' },
  play: async (context) => {
    await expect(bar(context)).toBeVisible();
    await expect(within(bar(context)).getAllByRole('button')).toHaveLength(5);
  },
};

/** B. Floating dock inset from the screen edges, with a border and a soft shadow; foreground badge. */
export const VariantB: Story = {
  args: { variant: 'b' },
  play: async (context) => {
    await expect(bar(context)).toBeVisible();
  },
};

/** C. Icon-first: the open icon on a small pill, Ask as a foreground-colored circle. */
export const VariantC: Story = {
  args: { variant: 'c' },
  play: async (context) => {
    await expect(bar(context)).toBeVisible();
  },
};

/** B with Messages open, 12 open questions (9+), and Archive disabled. */
export const BadgeAndDisabled: Story = {
  args: {
    variant: 'b',
    current: 'messages',
    questionCount: 12,
    archiveDisabled: true,
  },
  play: async (context) => {
    const nav = within(bar(context));
    await expect(nav.getByRole('button', { name: /9\+/ })).toBeVisible();
    const buttons = nav.getAllByRole('button');
    await expect(buttons[3]).toBeDisabled();
  },
};
