import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { BellIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { modalDocsParameters } from '../../../../.storybook/support/modal-docs';
import { SettingsEntryRow } from '@/shared/ui/settings-entry-row';
import { DEFAULT_NOTIFICATION_SETTINGS } from '../model';
import { NotificationDialogView } from './NotificationDialogView';

// The dialog the "Phone notifications" row opens: a modal on the PC, a bottom sheet on a phone.
const meta = {
  title: 'Settings/NotificationDialogView',
  component: NotificationDialogView,
  parameters: { layout: 'fullscreen', ...modalDocsParameters },
  args: {
    kind: 'dialog',
    onClose: fn(),
    onChange: fn(),
    state: { status: 'ready', settings: DEFAULT_NOTIFICATION_SETTINGS, saveFailed: false },
  },
} satisfies Meta<typeof NotificationDialogView>;
export default meta;
type Story = StoryObj<typeof meta>;

// Stands in for the Home Screen control the board passes in (the push-notifications row), with
// the board's own texts so both languages read in full.
function EnableRow({ on }: { on: boolean }) {
  const { t } = useTranslation();
  return (
    <SettingsEntryRow
      icon={BellIcon}
      title={t('push.title')}
      body={t(on ? 'push.onBody' : 'push.offBody')}
      action={t(on ? 'push.disable' : 'push.enable')}
      onOpen={fn()}
    />
  );
}

/** The PC modal: the three kinds. */
export const Desktop: Story = {
  play: async ({ args }) => {
    const dialog = await within(document.body).findByRole('dialog');
    // The dialog fades in, so wait until it is visible rather than asserting at once.
    const heading = within(dialog).getByRole('heading', { name: 'Phone notifications' });
    await waitFor(() => expect(heading).toBeVisible());
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /^History additions/ }));
    await expect(args.onChange).toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await expect(args.onClose).toHaveBeenCalledTimes(1);
  },
};

/** The bottom sheet of a phone in the browser: the same choices, no Home Screen control. */
export const Phone: Story = {
  args: { kind: 'sheet' },
  globals: { viewport: { value: 'mobile1' } },
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
    push: <EnableRow on={false} />,
  },
  globals: { viewport: { value: 'mobile1' } },
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
    push: <EnableRow on />,
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
