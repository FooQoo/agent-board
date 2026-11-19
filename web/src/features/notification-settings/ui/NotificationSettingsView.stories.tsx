import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { DEFAULT_NOTIFICATION_SETTINGS, type NotificationSettings } from '../model';
import { NotificationSettingsView } from './NotificationSettingsView';

// The "Phone notifications" section as the settings dialog shows it, on the PC and the phone.
const meta = {
  title: 'Settings/NotificationSettingsView',
  component: NotificationSettingsView,
  args: {
    state: { status: 'ready', settings: DEFAULT_NOTIFICATION_SETTINGS, saveFailed: false },
    onChange: fn(),
  },
  decorators: [
    (Story) => (
      <div className="modal settings-dialog" style={{ maxWidth: 640, padding: 24 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof NotificationSettingsView>;
export default meta;
type Story = StoryObj<typeof meta>;

const custom: NotificationSettings = {
  kinds: { results: true, questions: true, stateChanges: true, history: true },
  stateChanges: { started: false, pending: true, done: true },
  periodic: { enabled: true, intervalMinutes: 120 },
  revision: 7,
};

/** Results and questions on, the rest off; periodic off. */
export const Defaults: Story = {
  play: async ({ canvasElement, args }) => {
    const view = within(canvasElement);
    await expect(view.getByRole('checkbox', { name: /^Results/ })).toBeChecked();
    await expect(view.getByRole('checkbox', { name: /^Card state changes/ })).not.toBeChecked();
    await expect(view.getByRole('checkbox', { name: 'Started' })).toBeDisabled();
    await userEvent.click(view.getByRole('checkbox', { name: /^History additions/ }));
    await expect(args.onChange).toHaveBeenCalled();
  },
};

/** Every kind on, one state change dropped, and a two-hour periodic notification. */
export const CustomChoices: Story = {
  args: { state: { status: 'ready', settings: custom, saveFailed: false } },
  play: async ({ canvasElement }) => {
    const view = within(canvasElement);
    await expect(view.getByRole('checkbox', { name: 'Started' })).not.toBeChecked();
    await expect(view.getByRole('radio', { name: '2 hours' })).toBeChecked();
  },
};

/** Everything off is allowed. */
export const AllOff: Story = {
  args: {
    state: {
      status: 'ready',
      settings: {
        ...DEFAULT_NOTIFICATION_SETTINGS,
        kinds: { results: false, questions: false, stateChanges: false, history: false },
      },
      saveFailed: false,
    },
  },
};

export const Loading: Story = { args: { state: { status: 'loading' } } };

export const LoadFailed: Story = {
  args: { state: { status: 'failed' } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('alert')).toBeVisible();
  },
};

export const SaveFailed: Story = {
  args: { state: { status: 'ready', settings: custom, saveFailed: true } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('alert')).toBeVisible();
  },
};
