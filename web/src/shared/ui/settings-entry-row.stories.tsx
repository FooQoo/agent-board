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

/** A longer label widens its button; the chevron stays at the right edge. */
export const MobileConnection: Story = {
  args: {
    icon: SmartphoneIcon,
    title: 'Mobile connection',
    body: 'Check progress from your smartphone.',
    action: 'Connection settings',
  },
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole('button', { name: 'Connection settings' });
    await expect(button).toBeEnabled();
    await expect(button.querySelector('svg')).not.toBeNull();
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
        title="Mobile connection"
        body="Check progress from your smartphone."
        action="Connection settings"
      />
    </>
  ),
  play: async ({ canvasElement }) => {
    const rows = within(canvasElement).getAllByRole('region');
    await expect(rows).toHaveLength(2);
    const [first, second] = rows.map((row) => row.getBoundingClientRect());
    // The two rows touch, so the dialog's gap does not open a space between them.
    await expect(Math.round(second?.top ?? 0)).toBe(Math.round(first?.bottom ?? -1));
  },
};

/** A phone-width dialog: the button moves under the text and the row does not scroll sideways. */
export const NarrowDialog: Story = {
  args: {
    icon: SmartphoneIcon,
    title: 'Mobile connection',
    body: 'Check progress from your smartphone.',
    action: 'Connection settings',
  },
  globals: { width: 'phone-375' },
  decorators: [
    (Story) => (
      <div
        className="modal settings-dialog"
        style={{ position: 'static', width: 343, margin: '16px auto' }}
      >
        <div className="settings__entries">
          <Story />
        </div>
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
  },
};
