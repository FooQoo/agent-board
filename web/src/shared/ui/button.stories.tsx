import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { useTranslation } from 'react-i18next';
import { PlusIcon } from 'lucide-react';
import { BUTTON_SIZES, Button } from './button';

const meta = {
  title: 'Shared/UI/Button',
  component: Button,
  args: { children: 'Save', onClick: fn() },
  argTypes: {
    variant: { control: 'select', options: ['default', 'outline', 'destructive', 'ghost'] },
    size: { control: 'select', options: ['s', 'm', 'l', 'xl', '2xl'] },
    iconOnly: { control: 'boolean' },
    disabled: { control: 'boolean' },
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Outline: Story = { args: { variant: 'outline' } };

export const Destructive: Story = { args: { variant: 'destructive', children: 'Delete' } };

export const Ghost: Story = { args: { variant: 'ghost', children: 'Cancel' } };

export const SizeS: Story = { args: { size: 's', children: 'Size S' } };

export const SizeM: Story = { args: { size: 'm', children: 'Size M' } };

export const SizeL: Story = { args: { size: 'l', children: 'Size L' } };

export const SizeXL: Story = { args: { size: 'xl', children: 'Size XL' } };

export const Size2XL: Story = { args: { size: '2xl', children: 'Size 2XL' } };

/** The five fixed sizes side by side, with and without a label, so the scale can be compared. */
export const AllSizes: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
      {BUTTON_SIZES.map((size) => (
        <div key={size} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Button size={size}>{size.toUpperCase()}</Button>
          <Button size={size} variant="outline" iconOnly aria-label={`Add ${size}`}>
            <PlusIcon />
          </Button>
        </div>
      ))}
    </div>
  ),
  play: async ({ canvasElement }) => {
    for (const size of BUTTON_SIZES) {
      await expect(
        within(canvasElement).getByRole('button', { name: size.toUpperCase() }),
      ).toHaveAttribute('data-size', size);
    }
  },
};

export const Disabled: Story = { args: { disabled: true } };

/** Every variant and size side by side, as the product uses them. */
export const AllVariants: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(4, max-content)' }}>
      {(['default', 'outline', 'destructive', 'ghost'] as const).map((variant) => (
        <div key={variant} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Button variant={variant}>{variant}</Button>
          <Button variant={variant} size="s">
            s
          </Button>
        </div>
      ))}
    </div>
  ),
};

/** The icon size is a square with the icon in it, and the accessible name comes from aria-label. */
export const IconSize: Story = {
  args: {
    size: 'm',
    iconOnly: true,
    variant: 'outline',
    'aria-label': 'Add task',
    children: <PlusIcon />,
  },
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole('button', { name: 'Add task' });
    await expect(button).toHaveAttribute('data-icon-only');
  },
};

/** `asChild` renders the button's styles on the element it wraps, such as a link. */
export const AsLink: Story = {
  render: () => (
    <Button asChild variant="outline">
      <a href="#sample-link">Open link</a>
    </Button>
  ),
  play: async ({ canvasElement }) => {
    const link = within(canvasElement).getByRole('link', { name: 'Open link' });
    await expect(link.tagName).toBe('A');
    await expect(link).toHaveAttribute('data-slot', 'button');
  },
};

/** Focus reaches the button through the keyboard path, so the focus ring can show. */
export const FocusVisible: Story = {
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole('button', { name: 'Save' });
    button.focus();
    await expect(button).toHaveFocus();
  },
};

/** A real click reaches the handler exactly once. */
export const ClickCallsHandler: Story = {
  play: async ({ args, canvasElement }) => {
    const button = within(canvasElement).getByRole('button', { name: 'Save' });
    await userEvent.click(button);
    expect(args.onClick).toHaveBeenCalledTimes(1);
  },
};

/** Enter on the focused button runs the same handler as a click. */
export const EnterCallsHandler: Story = {
  play: async ({ args, canvasElement }) => {
    const button = within(canvasElement).getByRole('button', { name: 'Save' });
    button.focus();
    await userEvent.keyboard('{Enter}');
    await expect(args.onClick).toHaveBeenCalledTimes(1);
  },
};

/** The product's own label, translated at render: the same text as the adopted screen's button. */
function TranslatedButton({ labelKey }: { labelKey: 'simpleTask.submit' }) {
  const { t } = useTranslation();
  return <Button>{t(labelKey)}</Button>;
}

/** The primary button of the task form, with the product's own English label ("Submit task"). */
export const ProductSubmitLabel: Story = {
  render: () => <TranslatedButton labelKey="simpleTask.submit" />,
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('button', { name: 'Submit task' }),
    ).toBeInTheDocument();
  },
};
