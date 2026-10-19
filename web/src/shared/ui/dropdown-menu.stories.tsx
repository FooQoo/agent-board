import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, userEvent, within } from 'storybook/test';
import { Button } from './button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from './dropdown-menu';

const COLUMNS = [
  { value: 'todo', label: 'Todo' },
  { value: 'doing', label: 'Doing' },
  { value: 'done', label: 'Done' },
];

/** A single-choice menu. The chosen value is kept by the menu, and each change calls the callback. */
function ChoiceMenu({
  initial = 'todo',
  onValueChange,
}: {
  initial?: string;
  onValueChange: (value: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">Move task</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>Column</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => {
            setValue(next);
            onValueChange(next);
          }}
        >
          {COLUMNS.map((column) => (
            <DropdownMenuRadioItem key={column.value} value={column.value}>
              {column.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const meta = {
  title: 'Shared/UI/DropdownMenu',
  component: ChoiceMenu,
  args: { onValueChange: fn() },
} satisfies Meta<typeof ChoiceMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Closed: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button', { name: 'Move task' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  },
};

/** A click opens the menu with its label and the three choices, and the current one is checked. */
export const OpenedByClick: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Move task' }));
    const menu = within(document.body).getByRole('menu');
    await expect(within(menu).getByText('Column')).toBeInTheDocument();
    await expect(within(menu).getAllByRole('menuitemradio')).toHaveLength(3);
    await expect(within(menu).getByRole('menuitemradio', { name: 'Todo' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  },
};

/** Choosing an item calls the callback with its value and closes the menu. */
export const ChoosesItem: Story = {
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Move task' }));
    await userEvent.click(within(document.body).getByRole('menuitemradio', { name: 'Doing' }));
    await expect(args.onValueChange).toHaveBeenCalledWith('doing');
    await expect(within(document.body).queryByRole('menu')).toBeNull();
  },
};

/** The Enter key opens the menu from the trigger, and the first item receives the focus. */
export const KeyboardOpens: Story = {
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole('button', { name: 'Move task' });
    trigger.focus();
    await userEvent.keyboard('{Enter}');
    await expect(within(document.body).getByRole('menu')).toBeInTheDocument();
    await expect(within(document.body).getByRole('menuitemradio', { name: 'Todo' })).toHaveFocus();
  },
};
