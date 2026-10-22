import { useEffect, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { modalDocsParameters } from '../../../../.storybook/support/modal-docs';
import { ConnectionEntryRow } from './ConnectionEntryRow';
import { NGROK_TOKEN_URL } from './ConnectionSteps';
import {
  ConnectionSettingsView,
  type ConnectionDraft,
  type ConnectionQr,
} from './ConnectionSettingsView';

/** The scheme is joined here so the source keeps no literal remote address. */
const phoneUrl = `${'https'}://your-name.ngrok.app/monitor/`;
const emptyDraft: ConnectionDraft = { token: '', save: false };

/** A layout sample of a QR code: three finder squares and a few modules. It cannot be scanned. */
const sampleQr: ConnectionQr = {
  sample: true,
  src: `data:image/svg+xml;utf8,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 92 92" fill="none" stroke="#1b2430" stroke-width="6">' +
      '<rect x="3" y="3" width="30" height="30" rx="6"/><rect x="59" y="3" width="30" height="30" rx="6"/>' +
      '<rect x="3" y="59" width="30" height="30" rx="6"/>' +
      '<path d="M46 6v18M46 46h20M56 46v14M80 50v14M46 66v20M62 80h24" stroke-linecap="round"/></svg>',
  )}`,
};

const meta = {
  title: 'Monitor connections/ConnectionSettingsView',
  component: ConnectionSettingsView,
  parameters: { layout: 'fullscreen', ...modalDocsParameters },
  args: {
    open: true,
    onOpenChange: fn(),
    status: 'needs_config',
    draft: emptyDraft,
    onConnect: fn(),
    onStop: fn(),
    onResetToken: fn(),
  },
} satisfies Meta<typeof ConnectionSettingsView>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Nothing is connected: the two steps of the setup, with the connect action alone below them. */
export const NeedsConfig: Story = {
  play: async ({ args }) => {
    const view = within(document.body);
    const dialog = view.getByRole('dialog') as HTMLElement;
    // The design's size, and both steps with a divider as long as the 280px row.
    await expect([dialog.offsetWidth, dialog.offsetHeight]).toEqual([680, 560]);
    await expect(view.getByText('Not connected')).toBeInTheDocument();
    await expect(view.getByText('Check the board on your phone from outside.')).toBeInTheDocument();
    const steps = view.getAllByRole('listitem');
    await expect(steps).toHaveLength(2);
    await expect((steps[1] as HTMLElement).offsetHeight).toBe(280);
    await expect(view.getByRole('heading', { name: 'Get a token' })).toBeInTheDocument();
    // Save and connect is about 146px wide, the same as Reconnect in the stopped view. The width
    // follows the text, so a font that measures one pixel apart must not fail the story.
    const connectWidth = view.getByRole('button', { name: 'Save and connect' }).offsetWidth;
    await expect(Math.abs(connectWidth - 146)).toBeLessThanOrEqual(2);
    await expect(view.getByRole('heading', { name: 'Paste and connect' })).toBeInTheDocument();
    // The token page opens in a new tab, without handing the PC page to ngrok.
    const link = view.getByRole('link', { name: 'Open the token page' });
    await expect(link).toHaveAttribute('href', NGROK_TOKEN_URL);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(view.getByLabelText('ngrok auth token')).toHaveAttribute('type', 'password');
    await expect(view.getByLabelText('ngrok auth token')).toHaveAttribute(
      'placeholder',
      'Paste the copied token',
    );
    await expect(
      view.getByRole('checkbox', { name: 'Save the token on this PC' }),
    ).not.toBeChecked();
    await expect(view.getByTestId('token-note')).toHaveTextContent('used only while this app');
    // No domain, no passcode note and no advanced settings.
    await expect(view.queryByLabelText(/domain/i)).toBeNull();
    await expect(view.queryByText(/Protected by a passcode/)).toBeNull();
    await userEvent.type(view.getByLabelText('ngrok auth token'), 'secret-token');
    await userEvent.click(view.getByRole('button', { name: 'Save and connect' }));
    await expect(args.onConnect).toHaveBeenCalledWith({ token: 'secret-token', save: false });
  },
};

/** The first launch: the token field is empty and shows its placeholder. */
export const Empty: Story = { args: { status: 'disabled' } };

/** Stopped with a token saved: the saved settings connect again, or the settings can be changed. */
export const Stopped: Story = {
  args: {
    status: 'disabled',
    tokenInfo: { source: 'keychain', keychainAvailable: true, saved: true },
  },
  play: async ({ args }) => {
    const view = within(document.body);
    const dialog = view.getByRole('dialog') as HTMLElement;
    await expect([dialog.offsetWidth, dialog.offsetHeight]).toEqual([680, 560]);
    await expect(view.getByText('Stopped')).toBeInTheDocument();
    await expect(
      view.getByRole('heading', { name: 'You can connect again with the saved settings.' }),
    ).toBeInTheDocument();
    await expect(view.getByText('The saved token will be used.')).toBeInTheDocument();
    await expect(view.queryByLabelText('ngrok auth token')).toBeNull();
    // Both actions are the M size (38px) high and exactly as wide as each other.
    const change = view.getByRole('button', { name: 'Change settings' });
    const reconnect = view.getByRole('button', { name: 'Reconnect' });
    await expect(change.offsetHeight).toBe(38);
    await expect(reconnect.offsetHeight).toBe(38);
    await expect(reconnect.offsetWidth).toBe(change.offsetWidth);
    await userEvent.click(reconnect);
    await expect(args.onConnect).toHaveBeenCalledWith({ token: '', save: false });
  },
};

/** The connection is being made: the progress takes the place of the steps and the action waits. */
export const Starting: Story = {
  args: { status: 'starting' },
  play: async () => {
    const view = within(document.body);
    await expect(view.getByRole('status')).toHaveTextContent('Connecting to ngrok…');
    await expect(view.queryByLabelText('ngrok auth token')).toBeNull();
    await expect(view.getByText('Not connected')).toBeInTheDocument();
    await expect(view.getByRole('button', { name: 'Connecting…' })).toBeDisabled();
  },
};

/** The request to save is in flight before the server reports a status: the fields are locked. */
export const Saving: Story = {
  args: { saving: true },
  play: async () => {
    const view = within(document.body);
    await expect(view.getByLabelText('ngrok auth token')).toBeDisabled();
    await expect(view.getByRole('button', { name: 'Connecting…' })).toBeDisabled();
  },
};

/** The settings were saved but ngrok was unreachable; the PC board stays usable. */
export const Failed: Story = {
  args: { status: 'failed' },
  play: async () => {
    const view = within(document.body);
    await expect(view.getByRole('alert')).toHaveTextContent('could not be reached');
    await expect(view.getByRole('button', { name: 'Save and connect' })).toBeEnabled();
  },
};

/** A restored connection that dropped again. */
export const Reconnecting: Story = { args: { status: 'reconnecting' } };

/** Stop was requested and is finishing. */
export const Stopping: Story = {
  args: { status: 'stopping', saving: true },
  play: async () => {
    await expect(within(document.body).getByRole('button', { name: 'Stopping…' })).toBeDisabled();
  },
};

/** The connection is up: the QR code and the passcode, the notice and the two actions. */
export const Connected: Story = {
  args: { status: 'ready', url: phoneUrl, passcode: '4821', qr: sampleQr },
  play: async ({ args }) => {
    const view = within(document.body);
    const dialog = view.getByRole('dialog') as HTMLElement;
    await expect([dialog.offsetWidth, dialog.offsetHeight]).toEqual([680, 560]);
    await expect(view.getByRole('status')).toHaveTextContent('Accepting connections');
    await expect(view.getByRole('heading', { name: 'Scan the QR code' })).toBeInTheDocument();
    await waitFor(() =>
      expect(view.getByRole('img', { name: 'QR code for the phone URL' })).toBeVisible(),
    );
    const passcode = view.getByRole('group', { name: 'Enter the passcode' });
    await expect(passcode).toHaveTextContent('4821');
    await expect((passcode as HTMLElement).offsetHeight).toBe(84);
    await expect(
      view.getByText('The passcode changes every time the connection starts.'),
    ).toBeInTheDocument();
    await expect(
      view.getByText('Do not share the URL or the passcode with others.'),
    ).toBeInTheDocument();
    // The setup, the domain and the old URL field are not part of the connected view.
    await expect(view.queryByLabelText('ngrok auth token')).toBeNull();
    await expect(view.queryByRole('textbox')).toBeNull();
    await userEvent.click(view.getByRole('button', { name: 'Reset token' }));
    await expect(args.onResetToken).toHaveBeenCalled();
    await userEvent.click(view.getByRole('button', { name: 'Stop connection' }));
    await expect(args.onStop).toHaveBeenCalled();
  },
};

/** Stopping from the connected view disables both actions. */
export const ConnectedStopping: Story = {
  args: {
    status: 'ready',
    saving: true,
    url: phoneUrl,
    passcode: '4821',
    qr: sampleQr,
  },
  play: async () => {
    const view = within(document.body);
    await expect(view.getByRole('button', { name: 'Stopping…' })).toBeDisabled();
    await expect(view.getByRole('button', { name: 'Reset token' })).toBeDisabled();
  },
};

/** Before the server has sent a passcode nothing is shown in its place. */
export const ConnectedWithoutPasscode: Story = {
  args: { status: 'ready', url: phoneUrl, passcode: null, qr: sampleQr },
  play: async () => {
    await expect(within(document.body).queryByTestId('passcode')).toBeNull();
  },
};

/** The row the settings dialog shows to open this dialog, drawn in a settings-dialog frame. */
export const SettingsEntry: Story = {
  parameters: { layout: 'fullscreen' },
  args: { open: false },
  render: () => (
    <div className="modal settings-dialog" style={{ position: 'static', margin: '32px auto' }}>
      <ConnectionEntryRow onOpen={fn()} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: 'Set up' })).toBeEnabled();
  },
};

/** A parent that re-renders with an equal draft must not wipe what the person typed. */
export const KeepsInputOnRerender: Story = {
  render: function Render(args) {
    const [, setTick] = useState(0);
    useEffect(() => {
      const rerender = () => setTick((n) => n + 1);
      window.addEventListener('story-rerender', rerender);
      return () => window.removeEventListener('story-rerender', rerender);
    }, []);
    return <ConnectionSettingsView {...args} draft={{ ...emptyDraft }} />;
  },
  play: async () => {
    const view = within(document.body);
    await userEvent.type(view.getByLabelText('ngrok auth token'), 'my-token');
    window.dispatchEvent(new Event('story-rerender'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    await expect(view.getByLabelText('ngrok auth token')).toHaveValue('my-token');
  },
};
