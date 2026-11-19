import { useEffect, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { modalDocsParameters } from '../../../../.storybook/support/modal-docs';
import { ConnectionEntryRow } from './ConnectionEntryRow';
import { NGROK_TOKEN_URL } from './ConnectionSteps';
import {
  ConnectionSettingsView,
  type ConnectionDraft,
  type ConnectionDevice,
  type ConnectionQr,
} from './ConnectionSettingsView';

/** The scheme is joined here so the source keeps no literal remote address. */
const phoneUrl = `${'https'}://your-name.ngrok.app/monitor/`;
const emptyDraft: ConnectionDraft = { token: '', save: false, domain: '' };

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

const phones: ConnectionDevice[] = [
  {
    id: 'dev_0123456789abcdef',
    label: 'iPhone / Safari',
    createdAt: '2026-11-19T09:00:00Z',
    lastSeenAt: '2026-11-20T08:30:00Z',
  },
  {
    id: 'dev_fedcba9876543210',
    label: 'Android / Chrome',
    createdAt: '2026-11-10T09:00:00Z',
    lastSeenAt: '2026-11-12T08:30:00Z',
  },
];

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
    await expect([dialog.offsetWidth, dialog.offsetHeight]).toEqual([680, 700]);
    await expect(view.getByText('Not connected')).toBeInTheDocument();
    await expect(
      view.getByText('Open the board from your phone or tablet when you are away.'),
    ).toBeInTheDocument();
    const steps = view.getAllByRole('listitem');
    await expect(steps).toHaveLength(2);
    await expect((steps[1] as HTMLElement).offsetHeight).toBe(280);
    // Remote access is generally available: no public preview badge, notice, or link.
    await expect(view.queryByText('Public preview')).toBeNull();
    await expect(view.queryByRole('link', { name: 'documentation' })).toBeNull();
    await expect(view.getByRole('heading', { name: 'Get a token' })).toBeInTheDocument();
    // Save and connect is about 146px wide (macOS system font), the same as Reconnect in the stopped
    // view. The width follows the text, and the system font differs between macOS and Linux, so only
    // a button that stays one compact line, neither collapsed nor stretched, is required.
    const connect = view.getByRole('button', { name: 'Save and connect' });
    await expect(connect.offsetWidth).toBeGreaterThanOrEqual(110);
    await expect(connect.offsetWidth).toBeLessThanOrEqual(190);
    await expect(connect.offsetHeight).toBeLessThan(48);
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
    // The domain is optional but recommended; there is no passcode note and no advanced settings.
    await expect(view.getByLabelText('ngrok domain')).toHaveValue('');
    await expect(view.getByText('Recommended')).toBeInTheDocument();
    await expect(view.getByTestId('domain-note')).toHaveTextContent('address changes every time');
    await expect(view.queryByText(/Protected by a passcode/)).toBeNull();
    await userEvent.type(view.getByLabelText('ngrok auth token'), 'secret-token');
    await userEvent.click(view.getByRole('button', { name: 'Save and connect' }));
    await expect(args.onConnect).toHaveBeenCalledWith({
      token: 'secret-token',
      save: false,
      domain: '',
    });
  },
};

/** The recommended domain is typed with the token and goes out with it, trimmed by the caller. */
export const WithDomain: Story = {
  play: async ({ args }) => {
    const view = within(document.body);
    await userEvent.type(view.getByLabelText('ngrok domain'), 'example.ngrok-free.dev');
    await userEvent.type(view.getByLabelText('ngrok auth token'), 'secret-token');
    await userEvent.click(view.getByRole('button', { name: 'Save and connect' }));
    await expect(args.onConnect).toHaveBeenCalledWith({
      token: 'secret-token',
      save: false,
      domain: 'example.ngrok-free.dev',
    });
  },
};

/** The environment variable names the domain: the field only shows it and cannot be edited. */
export const DomainFromEnvironment: Story = {
  args: { domainEnv: 'example.ngrok-free.dev' },
  play: async () => {
    const view = within(document.body);
    const field = view.getByLabelText('ngrok domain');
    await expect(field).toHaveValue('example.ngrok-free.dev');
    await expect(field).toBeDisabled();
    await expect(view.getByTestId('domain-note')).toHaveTextContent('AGBOARD_NGROK_DOMAIN');
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
    await expect(view.getByText('Paused')).toBeInTheDocument();
    await expect(
      view.getByRole('heading', { name: 'Public access is paused. Registered phones are kept.' }),
    ).toBeInTheDocument();
    await expect(view.getByText('The saved token will be used.')).toBeInTheDocument();
    await expect(view.queryByLabelText('ngrok auth token')).toBeNull();
    // Both actions are the M size (38px) high and exactly as wide as each other.
    const change = view.getByRole('button', { name: 'Change settings' });
    const reconnect = view.getByRole('button', { name: 'Resume' });
    await expect(change.offsetHeight).toBe(38);
    await expect(reconnect.offsetHeight).toBe(38);
    await expect(reconnect.offsetWidth).toBe(change.offsetWidth);
    await userEvent.click(reconnect);
    await expect(args.onConnect).toHaveBeenCalledWith({ token: '', save: false, domain: '' });
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
    await expect(within(document.body).getByRole('button', { name: 'Pausing…' })).toBeDisabled();
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
    // The copy action is on, because the address of the selected project is there.
    await expect(view.getByRole('button', { name: 'Copy URL' })).toBeEnabled();
    await expect(
      view.getByText(
        'The passcode changes every time the connection starts. A phone needs it only the first time.',
      ),
    ).toBeInTheDocument();
    await expect(
      view.getByText('Do not share the URL or the passcode with others.'),
    ).toBeInTheDocument();
    // The setup, the domain and the old URL field are not part of the connected view.
    await expect(view.queryByLabelText('ngrok auth token')).toBeNull();
    await expect(view.queryByRole('textbox')).toBeNull();
    await expect(view.queryByText('Public preview')).toBeNull();
    await userEvent.click(view.getByRole('button', { name: 'Reset token' }));
    await expect(args.onResetToken).toHaveBeenCalled();
    await userEvent.click(view.getByRole('button', { name: 'Pause connection' }));
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
    await expect(view.getByRole('button', { name: 'Pausing…' })).toBeDisabled();
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
    await expect(canvas.getByRole('button', { name: 'Connection settings' })).toBeEnabled();
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

/** A connection without a selected project: no QR code and no copied URL. The note says why. */
const noProjectPlay = (locale: 'en' | 'ja') => async () => {
  const view = within(document.body);
  await expect(view.getByRole('status')).toBeInTheDocument();
  await expect(view.getByTestId('project-needed')).toHaveTextContent(
    locale === 'ja'
      ? 'ボードでプロジェクトを選ぶと、QRコードとURLが表示されます。'
      : 'Select a project on the board to show its QR code and URL.',
  );
  await expect(view.queryByRole('img', { name: /QR code/ })).toBeNull();
  await expect(
    view.getByRole('button', { name: locale === 'ja' ? 'URLをコピー' : 'Copy URL' }),
  ).toBeDisabled();
  // The passcode of the running connection is still shown.
  await expect(view.getByTestId('passcode')).toHaveTextContent('4821');
};

export const ConnectedWithoutProject: Story = {
  args: { status: 'ready', url: null, projectSelected: false, passcode: '4821', qr: null },
  play: noProjectPlay('en'),
};

/** The same state in Japanese. */
export const ConnectedWithoutProjectJa: Story = {
  args: { status: 'ready', url: null, projectSelected: false, passcode: '4821', qr: null },
  globals: { locale: 'ja' },
  play: noProjectPlay('ja'),
};

/** Registered phones are one click away in the status line, and the dialog keeps its size. */
export const ConnectedWithDevices: Story = {
  args: {
    status: 'ready',
    url: phoneUrl,
    passcode: '4821',
    qr: sampleQr,
    devices: phones,
    onRemoveDevice: fn(),
  },
  play: async ({ args }) => {
    const view = within(document.body);
    const dialog = view.getByRole('dialog') as HTMLElement;
    await expect([dialog.offsetWidth, dialog.offsetHeight]).toEqual([680, 560]);
    await userEvent.click(view.getByRole('button', { name: 'Registered phones (2)' }));
    await expect(view.getByRole('heading', { name: 'Registered phones' })).toBeInTheDocument();
    await expect(view.getByText('iPhone / Safari')).toBeInTheDocument();
    await expect(view.getByText('Android / Chrome')).toBeInTheDocument();
    await expect(view.getAllByRole('listitem')).toHaveLength(2);
    await expect([dialog.offsetWidth, dialog.offsetHeight]).toEqual([680, 560]);
    // Removing is per phone and names the phone.
    await userEvent.click(view.getByRole('button', { name: 'Remove Android / Chrome' }));
    await expect(args.onRemoveDevice).toHaveBeenCalledWith('dev_fedcba9876543210');
    await userEvent.click(view.getByRole('button', { name: 'Back' }));
    await expect(view.getByRole('heading', { name: 'Scan the QR code' })).toBeInTheDocument();
  },
};

/** Paused: registered phones are kept and the list says they come back on resume. */
export const PausedWithDevices: Story = {
  args: {
    status: 'disabled',
    tokenInfo: { source: 'keychain', keychainAvailable: true, saved: true },
    devices: phones,
  },
  play: async () => {
    const view = within(document.body);
    await userEvent.click(view.getByRole('button', { name: 'Registered phones (2)' }));
    await expect(
      view.getByText('Public access is paused. Registered phones come back when you resume.'),
    ).toBeInTheDocument();
    await expect(view.getByRole('button', { name: 'Remove iPhone / Safari' })).toBeEnabled();
  },
};

/** The list in Japanese, in the same frame. */
export const ConnectedWithDevicesJa: Story = {
  globals: { locale: 'ja' },
  args: { status: 'ready', url: phoneUrl, passcode: '4821', qr: sampleQr, devices: phones },
  play: async () => {
    const view = within(document.body);
    await userEvent.click(view.getByRole('button', { name: '登録済みのスマホ（2）' }));
    await expect(view.getByRole('button', { name: 'iPhone / Safariの登録を解除' })).toBeEnabled();
  },
};
