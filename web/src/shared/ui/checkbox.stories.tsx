import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { Checkbox } from './checkbox';

const meta = {
  title: 'Shared/UI/Checkbox',
  component: Checkbox,
  args: { 'aria-label': 'Accept terms', onCheckedChange: fn() },
  argTypes: {
    checked: { control: 'radio', options: [true, false, 'indeterminate'] },
    disabled: { control: 'boolean' },
  },
} satisfies Meta<typeof Checkbox>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Unchecked: Story = {
  args: { checked: false },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('checkbox', { name: 'Accept terms' }),
    ).toHaveAttribute('aria-checked', 'false');
  },
};

export const Checked: Story = {
  args: { checked: true },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('checkbox', { name: 'Accept terms' }),
    ).toHaveAttribute('aria-checked', 'true');
  },
};

export const Indeterminate: Story = {
  args: { checked: 'indeterminate' },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('checkbox', { name: 'Accept terms' }),
    ).toHaveAttribute('aria-checked', 'mixed');
  },
};

export const Disabled: Story = {
  args: { checked: true, disabled: true },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('checkbox', { name: 'Accept terms' }),
    ).toBeDisabled();
  },
};

export const Invalid: Story = {
  args: { checked: false, 'aria-invalid': true },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('checkbox', { name: 'Accept terms' }),
    ).toHaveAttribute('aria-invalid', 'true');
  },
};

/** Focus reaches the box, and Space toggles it once through the callback. */
export const KeyboardToggle: Story = {
  args: { checked: false },
  play: async ({ args, canvasElement }) => {
    const box = within(canvasElement).getByRole('checkbox', { name: 'Accept terms' });
    box.focus();
    await expect(box).toHaveFocus();
    await userEvent.keyboard(' ');
    await expect(args.onCheckedChange).toHaveBeenCalledTimes(1);
    await expect(args.onCheckedChange).toHaveBeenCalledWith(true);
  },
};
