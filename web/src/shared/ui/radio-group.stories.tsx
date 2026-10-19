import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { Label } from './label';
import { RadioGroup, RadioGroupItem } from './radio-group';

const meta = {
  title: 'Shared/UI/RadioGroup',
  component: RadioGroup,
  args: { defaultValue: 'todo', onValueChange: fn() },
} satisfies Meta<typeof RadioGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

const OPTIONS = [
  { value: 'todo', label: 'Todo' },
  { value: 'doing', label: 'Doing' },
  { value: 'done', label: 'Done' },
] as const;

/** Three choices with one selected. Each choice is a labelled radio with its own id. */
function Choices({
  disabledValue,
  invalid = false,
}: {
  disabledValue?: string;
  invalid?: boolean;
}) {
  return (
    <>
      {OPTIONS.map((option) => (
        <div key={option.value} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <RadioGroupItem
            id={`choice-${option.value}`}
            value={option.value}
            disabled={option.value === disabledValue}
            aria-invalid={invalid || undefined}
          />
          <Label htmlFor={`choice-${option.value}`}>{option.label}</Label>
        </div>
      ))}
    </>
  );
}

export const Default: Story = {
  render: (args) => (
    <RadioGroup {...args}>
      <Choices />
    </RadioGroup>
  ),
  play: async ({ canvasElement }) => {
    const todo = within(canvasElement).getByRole('radio', { name: 'Todo' });
    await expect(todo).toHaveAttribute('aria-checked', 'true');
    await expect(within(canvasElement).getByRole('radio', { name: 'Doing' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  },
};

/** A disabled choice cannot be selected by a click, and its label keeps the text. */
export const DisabledChoice: Story = {
  render: (args) => (
    <RadioGroup {...args}>
      <Choices disabledValue="done" />
    </RadioGroup>
  ),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('radio', { name: 'Done' })).toBeDisabled();
  },
};

export const Invalid: Story = {
  render: (args) => (
    <RadioGroup {...args} aria-invalid>
      <Choices invalid />
    </RadioGroup>
  ),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('radio', { name: 'Todo' })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
  },
};

/**
 * Arrow keys move the focus to the next choice, and Space checks the focused choice and calls the change
 * callback with its value. The arrow keys alone do not check a choice in this Story's event model.
 */
export const KeyboardSelects: Story = {
  render: (args) => (
    <RadioGroup {...args}>
      <Choices />
    </RadioGroup>
  ),
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    canvas.getByRole('radio', { name: 'Todo' }).focus();
    await userEvent.keyboard('{ArrowDown}');
    await expect(canvas.getByRole('radio', { name: 'Doing' })).toHaveFocus();
    await userEvent.keyboard(' ');
    await expect(args.onValueChange).toHaveBeenCalledWith('doing');
    await expect(canvas.getByRole('radio', { name: 'Doing' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  },
};
