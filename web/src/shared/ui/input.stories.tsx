import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { Input } from './input';

const meta = {
  title: 'Shared/UI/Input',
  component: Input,
  args: { placeholder: 'Project name', 'aria-label': 'Project name', onChange: fn() },
  argTypes: {
    type: { control: 'select', options: ['text', 'search', 'email', 'number'] },
    disabled: { control: 'boolean' },
  },
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  play: async ({ canvasElement }) => {
    const input = within(canvasElement).getByRole('textbox', { name: 'Project name' });
    await expect(input).toHaveAttribute('placeholder', 'Project name');
    await expect(input).toHaveValue('');
  },
};

export const WithValue: Story = {
  args: { defaultValue: 'agent-board' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('textbox', { name: 'Project name' })).toHaveValue(
      'agent-board',
    );
  },
};

export const Disabled: Story = {
  args: { disabled: true, defaultValue: 'locked' },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('textbox', { name: 'Project name' }),
    ).toBeDisabled();
  },
};

export const Invalid: Story = {
  args: { 'aria-invalid': true, defaultValue: '' },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('textbox', { name: 'Project name' }),
    ).toHaveAttribute('aria-invalid', 'true');
  },
};

/** Typing reaches the change callback once per character, and focus stays in the field. */
export const TypingCallsChange: Story = {
  play: async ({ args, canvasElement }) => {
    const input = within(canvasElement).getByRole('textbox', { name: 'Project name' });
    await userEvent.click(input);
    await expect(input).toHaveFocus();
    await userEvent.type(input, 'abc');
    await expect(args.onChange).toHaveBeenCalledTimes(3);
    await expect(input).toHaveValue('abc');
  },
};
