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
  kinds: { results: true, questions: false, history: true, summary: true },
  summary: { intervalMinutes: 120 },
  revision: 7,
};

/** Results on, questions and history off. */
export const Defaults: Story = {
  play: async ({ canvasElement, args }) => {
    const view = within(canvasElement);
    await expect(view.getByRole('checkbox', { name: /^Results/ })).toBeChecked();
    await expect(view.getByRole('checkbox', { name: /^History additions/ })).not.toBeChecked();
    await userEvent.click(view.getByRole('checkbox', { name: /^History additions/ }));
    await expect(args.onChange).toHaveBeenCalled();
  },
};

/** Questions off, results and history on. */
export const CustomChoices: Story = {
  args: { state: { status: 'ready', settings: custom, saveFailed: false } },
  play: async ({ canvasElement }) => {
    const view = within(canvasElement);
    await expect(view.getByRole('checkbox', { name: /^Questions that need/ })).not.toBeChecked();
    await expect(view.getByRole('checkbox', { name: /^History additions/ })).toBeChecked();
  },
};

/** Everything off is allowed. */
export const AllOff: Story = {
  args: {
    state: {
      status: 'ready',
      settings: {
        ...DEFAULT_NOTIFICATION_SETTINGS,
        kinds: { results: false, questions: false, history: false, summary: false },
        summary: { intervalMinutes: 0 },
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
