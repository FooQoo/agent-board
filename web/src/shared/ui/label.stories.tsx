import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { Input } from './input';
import { Label } from './label';

const meta = {
  title: 'Shared/UI/Label',
  component: Label,
  args: { children: 'Project name', htmlFor: 'label-project-name' },
} satisfies Meta<typeof Label>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Project name')).toHaveAttribute(
      'data-slot',
      'label',
    );
  },
};

/** Label and field are linked by `htmlFor`: a click on the label moves focus into the field. */
export const FocusesField: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 8, width: 260 }}>
      <Label htmlFor="label-project-name">Project name</Label>
      <Input id="label-project-name" />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByText('Project name'));
    await expect(canvas.getByRole('textbox', { name: 'Project name' })).toHaveFocus();
  },
};

/** Inside a disabled group the label follows the group's disabled state through its data attribute. */
export const DisabledGroup: Story = {
  render: () => (
    <div className="group" data-disabled="true" style={{ display: 'grid', gap: 8, width: 260 }}>
      <Label htmlFor="label-disabled-field">Locked field</Label>
      <Input id="label-disabled-field" disabled defaultValue="locked" />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Locked field')).toHaveAttribute(
      'data-slot',
      'label',
    );
  },
};
