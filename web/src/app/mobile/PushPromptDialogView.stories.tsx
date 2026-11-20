import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { modalDocsParameters } from '../../../.storybook/support/modal-docs';
// The bottom sheet's position and animation live in the phone board's stylesheet.
import '../../pages/monitor/monitor-screen.css';
import { PushPromptDialogView } from '../../features/push-notifications/ui/PushPromptDialogView';

// The sheet the Home Screen app shows once, asking to turn notifications on. The toolbar switches
// the language and the theme.
const meta = {
  title: 'PushNotifications/PushPromptDialogView',
  component: PushPromptDialogView,
  parameters: { layout: 'fullscreen', ...modalDocsParameters },
  globals: { viewport: { value: 'mobile1' } },
  args: { onEnable: fn(), onClose: fn() },
} satisfies Meta<typeof PushPromptDialogView>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The guide: one button asks for the permission, the other closes it for good. */
export const Guide: Story = {
  play: async ({ args }) => {
    const dialog = await within(document.body).findByRole('dialog');
    const enable = within(dialog).getByRole('button', { name: 'Enable notifications' });
    await waitFor(() => expect(enable).toBeVisible());
    await userEvent.click(enable);
    await expect(args.onEnable).toHaveBeenCalledOnce();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Not now' }));
    await expect(args.onClose).toHaveBeenCalledOnce();
  },
};

/** Japanese in the dark theme. */
export const DarkJapanese: Story = {
  globals: { locale: 'ja', mode: 'dark', accent: 'sky' },
  play: async () => {
    const dialog = await within(document.body).findByRole('dialog');
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: '通知を有効にする' })).toBeVisible(),
    );
  },
};

/** The permission request failed: the message stays and the buttons stay usable. */
export const Failed: Story = {
  args: { failed: true },
  play: async () => {
    const alert = await within(document.body).findByRole('alert');
    await waitFor(() => expect(alert).toBeVisible());
  },
};

/** The permission prompt is open: the buttons are disabled. */
export const Busy: Story = {
  args: { busy: true },
  play: async () => {
    const dialog = await within(document.body).findByRole('dialog');
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Enable notifications' })).toBeDisabled(),
    );
  },
};
