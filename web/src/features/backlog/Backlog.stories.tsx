import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { makeTask } from '../../../.storybook/support/fixtures';
import { BacklogBar } from './BacklogBar';
import { SendConfirm } from './SendConfirm';

const meta = {
  title: 'Backlog/Send',
  component: BacklogBar,
  args: { count: 2, busy: false, onCancel: fn(), onSend: fn() },
} satisfies Meta<typeof BacklogBar>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The PC lane's bar of the selection mode: the count, and Cancel and Send in two buttons of the same width. */
export const Bar: Story = {
  play: async ({ canvasElement, args }) => {
    const bar = within(canvasElement).getByRole('region', { name: 'Send selected cards' });
    await expect(within(bar).getByText('2 selected')).toBeVisible();
    const cancel = within(bar).getByRole('button', { name: 'Cancel' });
    const send = within(bar).getByRole('button', { name: 'Send to Todo (2)' });
    await expect(Math.abs(cancel.offsetWidth - send.offsetWidth)).toBeLessThan(2);
    await userEvent.click(send);
    await expect(args.onSend).toHaveBeenCalledOnce();
    await userEvent.click(cancel);
    await expect(args.onCancel).toHaveBeenCalledOnce();
  },
};

/** Nothing is picked yet: the send button waits. */
export const BarWithNothingPicked: Story = {
  args: { count: 0 },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('button', { name: 'Send to Todo (0)' }),
    ).toBeDisabled();
  },
};

const warned = [
  makeTask({
    id: 32,
    title: 'Plan the migration guide',
    taskStatus: 'backlog',
    openQuestionIds: ['Q-5'],
  }),
];

/** The warning names the cards with an open question, and the send waits for the check. */
export const ConfirmDialog: Story = {
  render: () => (
    <SendConfirm
      kind="dialog"
      count={2}
      warned={warned}
      busy={false}
      onConfirm={fn()}
      onCancel={fn()}
    />
  ),
  play: async () => {
    const dialog = within(document.body).getByRole('dialog', { name: 'Send to Todo' });
    await expect(within(dialog).getByRole('alert')).toHaveTextContent('#32');
    const send = within(dialog).getByRole('button', { name: 'Send to Todo' });
    await expect(send).toBeDisabled();
    await userEvent.click(within(dialog).getByRole('checkbox'));
    await expect(send).toBeEnabled();
  },
};

/** On a phone the same confirmation is a bottom sheet. */
export const ConfirmSheet: Story = {
  render: () => (
    <SendConfirm
      kind="sheet"
      count={1}
      warned={warned}
      busy={false}
      onConfirm={fn()}
      onCancel={fn()}
    />
  ),
  play: async () => {
    const sheet = await within(document.body).findByRole('dialog', { name: 'Send to Todo' });
    await expect(within(sheet).getByRole('alert')).toHaveTextContent('Plan the migration guide');
  },
};
