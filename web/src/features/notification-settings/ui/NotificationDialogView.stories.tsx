import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { BellIcon } from 'lucide-react';
import { SettingsEntryRow } from '@/shared/ui/settings-entry-row';
import { DEFAULT_NOTIFICATION_SETTINGS } from '../model';
import { NotificationDialogView } from './NotificationDialogView';

// The dialog the "Phone notifications" row opens: a modal on the PC, a bottom sheet on a phone.
const meta = {
  title: 'Settings/NotificationDialogView',
  component: NotificationDialogView,
  parameters: { layout: 'fullscreen' },
  args: {
    kind: 'dialog',
    onClose: fn(),
    onChange: fn(),
    state: { status: 'ready', settings: DEFAULT_NOTIFICATION_SETTINGS, saveFailed: false },
  },
} satisfies Meta<typeof NotificationDialogView>;
export default meta;
type Story = StoryObj<typeof meta>;

// Stands in for the Home Screen control the board passes in (the push-notifications row).
const enableRow = (on: boolean) => (
  <SettingsEntryRow
    icon={BellIcon}
    title="Notifications"
    body={
      on
        ? 'Notifications are on for this phone.'
        : 'Get a notification on this phone when the board has something for you.'
    }
    action={on ? 'Turn off' : 'Enable notifications'}
    onOpen={fn()}
  />
);

/** The PC modal: the four kinds, the state-change picks, and the periodic notification. */
export const Desktop: Story = {
  play: async ({ args }) => {
    const dialog = await within(document.body).findByRole('dialog');
    await expect(
      within(dialog).getByRole('heading', { name: 'Phone notifications' }),
    ).toBeVisible();
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /^History additions/ }));
    await expect(args.onChange).toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await expect(args.onClose).toHaveBeenCalledTimes(1);
  },
};

/** The bottom sheet of a phone in the browser: the same choices, no Home Screen control. */
export const Phone: Story = {
  args: { kind: 'sheet' },
  globals: { width: 'phone-375' },
  parameters: { viewport: { defaultViewport: 'mobile' } },
  play: async () => {
    const dialog = await within(document.body).findByRole('dialog');
    await waitFor(() =>
      expect(within(dialog).getByRole('checkbox', { name: /^Results/ })).toBeVisible(),
    );
  },
};

/** The Home Screen app: the "Enable notifications" control sits above the choices. */
export const PhoneWithEnable: Story = {
  args: {
    kind: 'sheet',
    push: enableRow(false),
  },
  globals: { width: 'phone-375' },
  parameters: { viewport: { defaultViewport: 'mobile' } },
  play: async () => {
    const dialog = await within(document.body).findByRole('dialog');
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Enable notifications' })).toBeVisible(),
    );
  },
};

/** Japanese in the dark theme with the Home Screen control, on the PC. */
export const DarkJapanese: Story = {
  args: {
    push: enableRow(true),
  },
  globals: { locale: 'ja', mode: 'dark', accent: 'sky' },
};

export const LoadFailed: Story = {
  args: { state: { status: 'failed' } },
  play: async () => {
    const alert = await within(document.body).findByRole('alert');
    await waitFor(() => expect(alert).toBeVisible());
  },
};
