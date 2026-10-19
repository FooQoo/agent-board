import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { Badge } from './badge';

const VARIANTS = ['secondary', 'default', 'outline', 'muted', 'pending', 'destructive'] as const;

const meta = {
  title: 'Shared/UI/Badge',
  component: Badge,
  args: { children: 'Badge' },
  argTypes: {
    variant: { control: 'select', options: VARIANTS },
  },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The default variant is `secondary`, and the text is the only content of the badge. */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const badge = within(canvasElement).getByText('Badge');
    await expect(badge).toHaveAttribute('data-variant', 'secondary');
    await expect(badge).toHaveAttribute('data-slot', 'badge');
  },
};

export const Pending: Story = { args: { variant: 'pending', children: 'Pending' } };

export const Destructive: Story = { args: { variant: 'destructive', children: 'Failed' } };

/** Every variant side by side, in the colours the status labels use. */
export const AllVariants: Story = {
  render: () => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {VARIANTS.map((variant) => (
        <Badge key={variant} variant={variant}>
          {variant}
        </Badge>
      ))}
    </div>
  ),
  play: async ({ canvasElement }) => {
    for (const variant of VARIANTS) {
      await expect(within(canvasElement).getByText(variant)).toHaveAttribute(
        'data-variant',
        variant,
      );
    }
  },
};

/** `asChild` renders the badge as the element it wraps, such as a link, and keeps the badge style. */
export const AsLink: Story = {
  render: () => (
    <Badge asChild variant="outline">
      <a href="#sample-badge">Linked badge</a>
    </Badge>
  ),
  play: async ({ canvasElement }) => {
    const link = within(canvasElement).getByRole('link', { name: 'Linked badge' });
    await expect(link.tagName).toBe('A');
    await expect(link).toHaveAttribute('data-slot', 'badge');
  },
};

/** A long label stays on one line and is cut at the badge edge. */
export const LongText: Story = {
  args: {
    children: 'An unusually long status label that must not wrap onto a second line',
  },
  play: async ({ canvasElement }) => {
    const badge = within(canvasElement).getByText(/unusually long status label/);
    await expect(getComputedStyle(badge).whiteSpace).toBe('nowrap');
    await expect(getComputedStyle(badge).overflow).toBe('hidden');
  },
};
