import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { NotificationEntryRow } from './NotificationEntryRow';

// The row the settings dialog shows with the other feature rows: icon, title, one line, button.
const meta = {
  title: 'Settings/NotificationEntryRow',
  component: NotificationEntryRow,
  args: { onOpen: fn() },
  decorators: [
    (Story) => (
      <div className="modal settings-dialog" style={{ position: 'static', margin: '16px auto' }}>
        <div className="settings__entries">
          <Story />
        </div>
      </div>
    ),
  ],
} satisfies Meta<typeof NotificationEntryRow>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The button opens the dialog. */
export const Default: Story = {
  play: async ({ canvasElement, args }) => {
    const view = within(canvasElement);
    await expect(view.getByRole('heading', { name: 'Phone notifications' })).toBeVisible();
    await userEvent.click(view.getByRole('button', { name: 'Notification settings' }));
    await expect(args.onOpen).toHaveBeenCalledTimes(1);
  },
};

/** Japanese, in the dark theme. */
export const DarkJapanese: Story = {
  globals: { locale: 'ja', mode: 'dark', accent: 'sky' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button', { name: '通知の設定' })).toBeVisible();
  },
};
