import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import type { PushSupport } from '../state';
import { PushEntryRow } from './PushEntryRow';

const support: PushSupport = {
  secureContext: true,
  serviceWorker: true,
  pushManager: true,
  notification: true,
  standalone: true,
  ios: true,
};

// The notifications row of the phone settings, in each state the phone can be in.
const meta = {
  title: 'PushNotifications/PushEntryRow',
  component: PushEntryRow,
  args: { view: 'off', support, onEnable: fn(), onDisable: fn() },
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 420, padding: 16 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PushEntryRow>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Opened from the Home Screen and not yet turned on: the tap asks for the permission. */
export const Off: Story = {
  play: async ({ canvasElement, args }) => {
    await userEvent.click(
      within(canvasElement).getByRole('button', { name: 'Enable notifications' }),
    );
    await expect(args.onEnable).toHaveBeenCalledOnce();
  },
};

/** Turned on, with the way to turn it off. */
export const On: Story = {
  args: { view: 'on' },
  play: async ({ canvasElement, args }) => {
    await expect(
      within(canvasElement).getByText('Notifications are on for this phone.'),
    ).toBeVisible();
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Turn off' }));
    await expect(args.onDisable).toHaveBeenCalledOnce();
  },
};

/** The permission was refused: the board works, and the row says how to allow it again. */
export const Denied: Story = {
  args: { view: 'denied' },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText(/open Settings, choose Agent Board/),
    ).toBeVisible();
    await expect(within(canvasElement).queryByRole('button')).toBeNull();
  },
};

/** An iPhone tab in Safari: the board has to be added to the Home Screen first. */
export const UnsupportedIphoneTab: Story = {
  args: { view: 'unsupported', support: { ...support, pushManager: false, standalone: false } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText(/Add to Home Screen/)).toBeVisible();
    await expect(within(canvasElement).queryByRole('button')).toBeNull();
  },
};

/** A browser that cannot receive notifications at all. */
export const UnsupportedBrowser: Story = {
  args: {
    view: 'unsupported',
    support: { ...support, pushManager: false, ios: false, standalone: false },
  },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText('This browser cannot receive notifications.'),
    ).toBeVisible();
  },
};

/** The session was opened without a registered device. */
export const NeedsDevice: Story = {
  args: { view: 'needsDevice' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText(/not registered yet/)).toBeVisible();
  },
};

/** Waiting on the permission prompt or the PC: the button cannot be pressed twice. */
export const Busy: Story = {
  args: { busy: true },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button')).toBeDisabled();
  },
};

/** The last change failed. */
export const Failed: Story = {
  args: { failed: true },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText(/Could not change the notification/),
    ).toBeVisible();
  },
};
