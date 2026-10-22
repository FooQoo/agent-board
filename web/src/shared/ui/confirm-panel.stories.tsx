import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { ConfirmPanel } from './confirm-panel';

const meta = {
  title: 'Shared/UI/ConfirmPanel',
  component: ConfirmPanel,
  args: {
    message: 'The epic details and images of ACCEPTANCE are deleted too. This cannot be undone.',
    title: 'Delete this epic?',
    confirmLabel: 'Delete epic',
    cancelLabel: 'Cancel',
    busy: false,
    onConfirm: fn(),
    onCancel: fn(),
  },
} satisfies Meta<typeof ConfirmPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement, args }) => {
    const view = within(canvasElement);
    const confirm = view.getByRole('button', { name: 'Delete epic' });
    const cancel = view.getByRole('button', { name: 'Cancel' });
    await expect(confirm.offsetHeight).toBe(30);
    await expect(confirm.offsetWidth).toBe(cancel.offsetWidth);
    await userEvent.click(cancel);
    await expect(args.onCancel).toHaveBeenCalled();
  },
};

export const Failed: Story = { args: { error: 'A task still uses this epic.' } };

export const Busy: Story = { args: { busy: true } };
