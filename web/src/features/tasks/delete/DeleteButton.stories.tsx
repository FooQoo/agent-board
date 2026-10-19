import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { DeleteButton } from './DeleteButton';
const meta: Meta<typeof DeleteButton> = {
  title: 'Task/Dialogs/DeleteButton',
  component: DeleteButton,
  args: { onClick: fn() },
};
export default meta;
type Story = StoryObj<typeof meta>;
export const Delete: Story = {};
export const ArchiveWithLabel: Story = { args: { action: 'archive', showLabel: true } };
