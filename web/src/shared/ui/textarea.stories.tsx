import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { Textarea } from './textarea';

const meta = {
  title: 'Shared/UI/Textarea',
  component: Textarea,
  args: { placeholder: 'What should be done?', 'aria-label': 'Description', onChange: fn() },
  argTypes: { disabled: { control: 'boolean' } },
} satisfies Meta<typeof Textarea>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  play: async ({ canvasElement }) => {
    const field = within(canvasElement).getByRole('textbox', { name: 'Description' });
    await expect(field.tagName).toBe('TEXTAREA');
    await expect(field).toHaveValue('');
  },
};

/** Several lines grow the field (`field-sizing: content`), so no line is hidden. */
export const MultiLine: Story = {
  args: {
    defaultValue: 'First line of the request.\nSecond line with more detail.\nThird line.',
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('textbox', { name: 'Description' })).toHaveValue(
      'First line of the request.\nSecond line with more detail.\nThird line.',
    );
  },
};

export const Disabled: Story = {
  args: { disabled: true, defaultValue: 'Read only for now.' },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('textbox', { name: 'Description' }),
    ).toBeDisabled();
  },
};

export const Invalid: Story = {
  args: { 'aria-invalid': true, defaultValue: '' },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('textbox', { name: 'Description' }),
    ).toHaveAttribute('aria-invalid', 'true');
  },
};

/** Typing reaches the change callback, and Enter adds a line rather than leaving the field. */
export const TypingAddsLine: Story = {
  play: async ({ args, canvasElement }) => {
    const field = within(canvasElement).getByRole('textbox', { name: 'Description' });
    await userEvent.click(field);
    await userEvent.type(field, 'one{Enter}two');
    await expect(field).toHaveValue('one\ntwo');
    await expect(args.onChange).toHaveBeenCalled();
  },
};
