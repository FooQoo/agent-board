import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';
import type { AcceptanceItem } from '../../../shared/api/contracts';
import { AcceptanceEditor } from './AcceptanceEditor';

function AcceptanceEditorHost({
  initial,
  disabled = false,
}: {
  initial: AcceptanceItem[];
  disabled?: boolean;
}) {
  const [items, setItems] = useState(initial);
  return <AcceptanceEditor items={items} onChange={setItems} disabled={disabled} />;
}

const meta = {
  title: 'Task/Acceptance/AcceptanceEditor',
  component: AcceptanceEditorHost,
  args: { initial: [{ id: 'AC-1', text: 'Keep the existing behavior', done: false }] },
} satisfies Meta<typeof AcceptanceEditorHost>;

export default meta;
type Story = StoryObj<typeof meta>;

export const EditConditions: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const text = canvas.getByRole('textbox', { name: 'Condition AC-1' });
    await userEvent.clear(text);
    await userEvent.type(text, 'Preserve edits on retry');
    await expect(text).toHaveValue('Preserve edits on retry');
    await userEvent.click(canvas.getByRole('checkbox', { name: 'Done: AC-1' }));
    await expect(canvas.getByRole('checkbox', { name: 'Done: AC-1' })).toBeChecked();
    await userEvent.click(canvas.getByRole('button', { name: /Add condition/i }));
    await expect(canvas.getByRole('textbox', { name: 'Condition AC-2' })).toHaveFocus();
    await userEvent.click(canvas.getByRole('button', { name: 'Remove AC-1' }));
    await expect(canvas.queryByRole('textbox', { name: 'Condition AC-1' })).toBeNull();
  },
};

export const InvalidCondition: Story = {
  args: { initial: [{ id: 'AC-1', text: '', done: false }] },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('alert')).toBeInTheDocument();
    await expect(
      within(canvasElement).getByRole('textbox', { name: 'Condition AC-1' }),
    ).toHaveAttribute('aria-invalid', 'true');
  },
};

export const SavingDisabled: Story = {
  args: { disabled: true },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('button', { name: 'Add condition' }),
    ).toBeDisabled();
    await expect(
      within(canvasElement).getByRole('textbox', { name: 'Condition AC-1' }),
    ).toBeDisabled();
  },
};
