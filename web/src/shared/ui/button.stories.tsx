import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { Button } from './button';

const meta = {
  title: 'Shared/UI/Button',
  component: Button,
  args: { children: 'Save', onClick: fn() },
  argTypes: {
    variant: { control: 'select', options: ['default', 'outline', 'destructive', 'ghost'] },
    size: { control: 'select', options: ['default', 'sm', 'icon'] },
    disabled: { control: 'boolean' },
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Outline: Story = { args: { variant: 'outline' } };

export const Destructive: Story = { args: { variant: 'destructive', children: 'Delete' } };

export const Ghost: Story = { args: { variant: 'ghost', children: 'Cancel' } };

export const Small: Story = { args: { size: 'sm' } };

export const Disabled: Story = { args: { disabled: true } };

/** Every variant and size side by side, as the product uses them. */
export const AllVariants: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(4, max-content)' }}>
      {(['default', 'outline', 'destructive', 'ghost'] as const).map((variant) => (
        <div key={variant} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Button variant={variant}>{variant}</Button>
          <Button variant={variant} size="sm">
            sm
          </Button>
        </div>
      ))}
    </div>
  ),
};

/** A real click reaches the handler exactly once. */
export const ClickCallsHandler: Story = {
  play: async ({ args, canvasElement }) => {
    const button = within(canvasElement).getByRole('button', { name: 'Save' });
    await userEvent.click(button);
    expect(args.onClick).toHaveBeenCalledTimes(1);
  },
};
