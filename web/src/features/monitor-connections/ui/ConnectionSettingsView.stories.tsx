import { useEffect, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { modalDocsParameters } from '../../../../.storybook/support/modal-docs';
import { ConnectionEntryRow } from './ConnectionEntryRow';
import {
  ConnectionSettingsView,
  type ConnectionDraft,
  type ConnectionQr,
} from './ConnectionSettingsView';

/** The scheme is joined here so the source keeps no literal remote address. */
const phoneUrl = `${'https'}://your-name.ngrok.app/monitor/`;
const emptyDraft: ConnectionDraft = { token: '', email: '', domain: '', save: false };
const filledDraft: ConnectionDraft = {
  token: '',
  email: 'owner@example.com',
  domain: '',
  save: false,
};

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
    draft: filledDraft,
    onConnect: fn(),
    onStop: fn(),
    onEdit: fn(),
  },
} satisfies Meta<typeof ConnectionSettingsView>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Nothing is configured yet: the three inputs, the access note and the connect action. */
export const NeedsConfig: Story = {
  play: async ({ args }) => {
    const view = within(document.body);
    await expect(view.getByRole('dialog')).toBeInTheDocument();
    await expect((view.getByRole('dialog') as HTMLElement).offsetWidth).toBe(680);
    await userEvent.type(view.getByLabelText('ngrok auth token'), 'secret-token');
    await userEvent.click(view.getByRole('button', { name: 'Save and connect' }));
    await expect(args.onConnect).toHaveBeenCalledWith({
      token: 'secret-token',
      email: 'owner@example.com',
      domain: '',
      save: false,
    });
    await expect(view.getByLabelText('ngrok auth token')).toHaveAttribute('type', 'password');
  },
};

/** The first launch: every input is empty and shows its placeholder. */
export const Empty: Story = { args: { status: 'disabled', draft: emptyDraft } };

/** The connection is being made: the form is read-only and the action shows progress. */
export const Starting: Story = {
  args: { status: 'starting', draft: emptyDraft },
  play: async () => {
    const view = within(document.body);
    await expect(view.getByRole('status')).toHaveTextContent('Connecting to ngrok…');
    await expect(view.getByLabelText('ngrok auth token')).toBeDisabled();
    await expect(view.getByRole('button', { name: 'Connecting…' })).toBeDisabled();
  },
};

/** The request to save is in flight before the server reports a status. */
export const Saving: Story = { args: { saving: true } };

/** The settings were saved but ngrok was unreachable; the PC board stays usable. */
export const Failed: Story = {
  args: { status: 'failed' },
  play: async () => {
    const view = within(document.body);
    await expect(view.getByRole('alert')).toHaveTextContent('could not be reached');
    await expect(view.getByRole('button', { name: 'Save and try again' })).toBeEnabled();
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

/** The connection is up: the URL, the QR code and the stop and edit actions. */
export const Connected: Story = {
  args: { status: 'ready', url: phoneUrl, qr: sampleQr },
  play: async ({ args }) => {
    const view = within(document.body);
    await expect((view.getByRole('dialog') as HTMLElement).offsetWidth).toBe(680);
    await expect(view.getByRole('status')).toHaveTextContent('Connected');
    await expect(view.getByLabelText('URL for your phone')).toHaveValue(phoneUrl);
    await userEvent.click(view.getByRole('button', { name: 'Change connection settings' }));
    await expect(args.onEdit).toHaveBeenCalled();
    await userEvent.click(view.getByRole('button', { name: 'Stop' }));
    await expect(args.onStop).toHaveBeenCalled();
  },
};

/** Stopping from the connected view disables both actions. */
export const ConnectedStopping: Story = {
  args: {
    status: 'ready',
    saving: true,
    url: phoneUrl,
    qr: sampleQr,
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
    return <ConnectionSettingsView {...args} draft={{ ...filledDraft }} />;
  },
  play: async () => {
    const view = within(document.body);
    await userEvent.type(view.getByLabelText('ngrok domain (optional)'), 'my.ngrok.app');
    window.dispatchEvent(new Event('story-rerender'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    await expect(view.getByLabelText('ngrok domain (optional)')).toHaveValue('my.ngrok.app');
  },
};
