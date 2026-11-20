import type { Meta, StoryObj } from '@storybook/react-vite';
import { BookOpenIcon, SmartphoneIcon } from 'lucide-react';
import { expect, fn, userEvent, within } from 'storybook/test';
import '../styles/modal.css';
import { SettingsEntryRow } from './settings-entry-row';

const meta = {
  title: 'Shared/UI/SettingsEntryRow',
  component: SettingsEntryRow,
  parameters: { layout: 'fullscreen' },
  args: {
    icon: BookOpenIcon,
    title: 'Tutorial',
    body: 'Try the basics with sample tasks.',
    action: 'Try it',
    onOpen: fn(),
  },
  // The row is drawn in a settings-dialog frame, in the list the dialog puts its rows in.
  decorators: [
    (Story) => (
      <div className="modal settings-dialog" style={{ position: 'static', margin: '32px auto' }}>
        <div className="settings__entries">
          <Story />
        </div>
      </div>
    ),
  ],
} satisfies Meta<typeof SettingsEntryRow>;

export default meta;
type Story = StoryObj<typeof meta>;

/** One row: the button opens the feature, and its description is the row's one line of text. */
export const Tutorial: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { name: 'Tutorial' })).toBeInTheDocument();
    const button = canvas.getByRole('button', { name: 'Try it' });
    await expect(button).toHaveAccessibleDescription('Try the basics with sample tasks.');
    await userEvent.click(button);
    await expect(args.onOpen).toHaveBeenCalledTimes(1);
  },
};

/** The longer label fits the same button width as a short one; the button has no icon. */
export const MobileConnection: Story = {
  args: {
    icon: SmartphoneIcon,
    title: 'Remote connection',
    body: 'Check progress from your smartphone.',
    action: 'Connection settings',
  },
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole('button', { name: 'Connection settings' });
    await expect(button).toBeEnabled();
    await expect(button.querySelector('svg')).toBeNull();
  },
};

/** The row in Japanese, in the dark theme with the sky accent. */
export const DarkJapanese: Story = {
  args: {
    title: 'チュートリアル',
    body: 'サンプルで基本操作を体験できます。',
    action: '試してみる',
  },
  globals: { locale: 'ja', mode: 'dark', accent: 'sky' },
};

/** Two rows in the list: each row draws its top rule and the list draws the last one. */
export const RowsInDialog: Story = {
  render: (args) => (
    <>
      <SettingsEntryRow {...args} />
      <SettingsEntryRow
        {...args}
        icon={SmartphoneIcon}
        title="Remote connection"
        body="Check progress from your smartphone."
        action="Connection settings"
      />
    </>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const rows = canvas.getAllByRole('region');
    await expect(rows).toHaveLength(2);
    const [first, second] = rows.map((row) => row.getBoundingClientRect());
    // The two rows touch, so the dialog's gap does not open a space between them.
    await expect(Math.round(second?.top ?? 0)).toBe(Math.round(first?.bottom ?? -1));
    // Both buttons are the shared outline button at size m and have the same width, whatever the label.
    const [tutorial, connection] = [
      canvas.getByRole('button', { name: 'Try it' }),
      canvas.getByRole('button', { name: 'Connection settings' }),
    ].map((button) => button.getBoundingClientRect());
    await expect(Math.round(tutorial?.width ?? 0)).toBe(Math.round(connection?.width ?? -1));
    await expect(Math.round(tutorial?.height ?? 0)).toBe(38);
  },
};

/** A phone-width dialog: the button moves under the text, is centered on the row, and the row does not scroll sideways. */
export const NarrowDialog: Story = {
  args: {
    icon: SmartphoneIcon,
    title: 'Remote connection',
    body: 'Check progress from your smartphone.',
    action: 'Connection settings',
  },
  globals: { width: 'phone-375' },
  // The meta decorator already draws the dialog; this one narrows the list to a phone sheet's width.
  decorators: [
    (Story) => (
      <div style={{ width: 311, margin: '0 auto' }}>
        <Story />
      </div>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole('button', { name: 'Connection settings' });
    const body = canvas.getByText('Check progress from your smartphone.');
    const dialog = canvasElement.querySelector('.modal') as HTMLElement;
    await expect(button.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      body.getBoundingClientRect().bottom,
    );
    await expect(button.getBoundingClientRect().right).toBeLessThanOrEqual(
      dialog.getBoundingClientRect().right,
    );
    await expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth);
    // The button is centered on the whole row, not on the text column beside the icon.
    const row = canvas.getByRole('region').getBoundingClientRect();
    const rect = button.getBoundingClientRect();
    await expect(Math.abs(rect.left + rect.width / 2 - (row.left + row.width / 2))).toBeLessThan(1);
  },
};

/** The tutorial row in Japanese at phone width: the short label is centered under the icon and text. */
export const NarrowDialogJapanese: Story = {
  args: {
    title: 'チュートリアル',
    body: 'サンプルで基本操作を体験できます。',
    action: '試してみる',
  },
  globals: { locale: 'ja', width: 'phone-375' },
  decorators: NarrowDialog.decorators,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole('button', { name: '試してみる' });
    const row = canvas.getByRole('region').getBoundingClientRect();
    const rect = button.getBoundingClientRect();
    await expect(Math.abs(rect.left + rect.width / 2 - (row.left + row.width / 2))).toBeLessThan(1);
  },
};
