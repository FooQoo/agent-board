import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { modalDocsParameters } from '../../../../.storybook/support/modal-docs';
import type { ConnectionSnapshot } from '../api';
import { ConnectionSettings } from './ConnectionSettings';

/** The scheme is joined here so the source keeps no literal remote address. */
const phoneUrl = `${'https'}://your-name.ngrok.app/monitor/`;

/** The passcode the simulated server makes for a ready connection. */
const passcode = '4821';

const idle: ConnectionSnapshot = {
  status: 'disabled',
  url: null,
  revision: 3,
  settings: { enabled: false },
  tokenConfigured: false,
  tokenSource: null,
  keychainAvailable: true,
  keychainTokenSaved: false,
  failure: null,
};

interface Mock {
  /** Requests as `METHOD path` with the body that was sent. */
  calls: { line: string; body: unknown }[];
  restore: () => void;
}

/**
 * Stands in for the local API: a start answers `starting` and the next read answers the outcome.
 * Nothing here reaches ngrok, so a `ready` state is a simulated one.
 */
function mockApi(
  initial: ConnectionSnapshot,
  options: {
    outcome?: 'ready' | 'failed' | 'hold';
    conflict?: boolean;
    saveFails?: boolean;
  } = {},
): Mock {
  let snapshot = initial;
  let pending: ConnectionSnapshot | null = null;
  const calls: Mock['calls'] = [];
  const original = window.fetch;
  const reply = (status: number, body: unknown) =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  window.fetch = (input, init) => {
    const path = String(input);
    if (!path.startsWith('/api/monitor-connections')) return original(input, init);
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ line: `${method} ${path}`, body });
    if (method === 'GET') {
      if (pending) {
        snapshot = pending;
        pending = null;
      }
      return reply(200, snapshot);
    }
    if (path.endsWith('/settings/ngrok')) {
      if (options.conflict)
        return reply(409, { error: { code: 'revision_conflict', message: '', reason: '' } });
      snapshot = {
        ...snapshot,
        revision: snapshot.revision + 1,
        settings: { enabled: body.enabled },
      };
      return reply(200, snapshot);
    }
    if (method === 'DELETE' && path.endsWith('/token')) {
      snapshot = {
        ...snapshot,
        keychainTokenSaved: false,
        tokenConfigured: snapshot.tokenSource === 'env',
        tokenSource: snapshot.tokenSource === 'env' ? 'env' : null,
      };
      return reply(200, snapshot);
    }
    if (path.endsWith('/start')) {
      if (body?.save && options.saveFails)
        return reply(409, { error: { code: 'keychain_unavailable', message: '', reason: '' } });
      const stored = Boolean(body?.save);
      if (body?.token)
        snapshot = {
          ...snapshot,
          tokenSource: 'session',
          keychainTokenSaved: snapshot.keychainTokenSaved || stored,
        };
      pending =
        options.outcome === 'hold'
          ? null
          : options.outcome === 'failed'
            ? { ...snapshot, status: 'failed', failure: 'connect_failed', tokenConfigured: true }
            : {
                ...snapshot,
                status: 'ready',
                url: phoneUrl,
                tokenConfigured: true,
                passcode,
              };
      snapshot = { ...snapshot, status: 'starting', tokenConfigured: true };
      if (stored) snapshot = { ...snapshot, tokenSource: 'session' };
      return reply(202, snapshot);
    }
    // A stopped connection has no passcode: the server stops sending it.
    const { passcode: _gone, ...stopped } = snapshot;
    snapshot = { ...stopped, status: 'disabled', url: null, failure: null };
    return reply(200, snapshot);
  };
  return {
    calls,
    restore: () => {
      window.fetch = original;
    },
  };
}

let mock: Mock | null = null;
const install = (initial: ConnectionSnapshot, options?: Parameters<typeof mockApi>[1]) => () => {
  mock = mockApi(initial, options);
  return () => mock?.restore();
};

const meta = {
  title: 'Monitor connections/ConnectionSettings',
  component: ConnectionSettings,
  parameters: { layout: 'fullscreen', ...modalDocsParameters },
  args: { open: true, onOpenChange: fn() },
} satisfies Meta<typeof ConnectionSettings>;
export default meta;
type Story = StoryObj<typeof meta>;

const connectedView = (view: ReturnType<typeof within>) =>
  view.findByRole('group', { name: 'Enter the passcode' }, { timeout: 5000 });

const saveBox = (view: ReturnType<typeof within>) =>
  view.getByRole('checkbox', { name: 'Save the token on this PC' });

/** Saves, starts, and reaches the connected view with a real, scannable QR image. */
export const SaveAndConnect: Story = {
  beforeEach: install(idle),
  play: async () => {
    const view = within(document.body);
    await userEvent.type(await view.findByLabelText('ngrok auth token'), 'story-token');
    await userEvent.click(view.getByRole('button', { name: 'Save and connect' }));
    await expect(await connectedView(view)).toHaveTextContent(passcode);
    await expect(view.getByText('Accepting connections')).toBeInTheDocument();
    const image = view.getByRole('img', { name: 'QR code for the phone URL' });
    await expect(image.getAttribute('src')).toMatch(/^data:image\/svg\+xml/);
    await expect(view.queryByText('Sample · not scannable')).toBeNull();
    const lines = mock?.calls.map((call) => call.line);
    await expect(lines).toContain('PUT /api/monitor-connections/settings/ngrok');
    await expect(lines).toContain('POST /api/monitor-connections/transports/ngrok/start');
    const start = mock?.calls.find((call) => call.line.includes('/start'));
    await expect(start?.body).toEqual({ token: 'story-token' });
    const save = mock?.calls.find((call) => call.line.startsWith('PUT'));
    await expect(JSON.stringify(save?.body)).not.toContain('story-token');
    // Only the enabled flag is saved with the settings: no domain, no email, no Google app.
    await expect(save?.body).toEqual({ enabled: true, revision: 3 });
  },
};

const connected: ConnectionSnapshot = {
  ...idle,
  status: 'ready',
  url: phoneUrl,
  tokenConfigured: true,
  settings: { enabled: true },
  passcode,
};

/** The connection is already up when the dialog opens: the QR image and the passcode. */
export const AlreadyConnected: Story = {
  beforeEach: install(connected),
  play: async () => {
    const view = within(document.body);
    await expect(await connectedView(view)).toHaveTextContent(passcode);
    await waitFor(() =>
      expect(view.getByRole('img', { name: 'QR code for the phone URL' })).toBeVisible(),
    );
    await expect(view.getByText('Accepting connections')).toBeInTheDocument();
  },
};

const connectedWithSavedToken: ConnectionSnapshot = {
  ...connected,
  tokenSource: 'keychain',
  keychainTokenSaved: true,
};

/** Stop closes the connection and keeps the saved token: the dialog shows the stopped state. */
export const StopConnection: Story = {
  beforeEach: install(connectedWithSavedToken),
  play: async () => {
    const view = within(document.body);
    await userEvent.click(await view.findByRole('button', { name: 'Stop connection' }));
    await waitFor(() =>
      expect(view.getByRole('button', { name: 'Reconnect' })).toBeInTheDocument(),
    );
    await expect(view.getByText('Stopped')).toBeInTheDocument();
    // The passcode belonged to the connection that ended and is not shown any more.
    await expect(view.queryByTestId('passcode')).toBeNull();
    await expect(mock?.calls.map((call) => call.line)).toContain(
      'POST /api/monitor-connections/transports/ngrok/stop',
    );
    // Stopping does not delete the token.
    await expect(mock?.calls.map((call) => call.line)).not.toContain(
      'DELETE /api/monitor-connections/token',
    );
  },
};

/** Reset token shows the setup again; a new token starts the connection again. */
export const ResetToken: Story = {
  beforeEach: install(connected),
  play: async () => {
    const view = within(document.body);
    await userEvent.click(await view.findByRole('button', { name: 'Reset token' }));
    await userEvent.type(await view.findByLabelText('ngrok auth token'), 'new-token');
    // Nothing was stopped by opening the setup.
    await expect(mock?.calls.map((call) => call.line)).not.toContain(
      'POST /api/monitor-connections/transports/ngrok/stop',
    );
    await userEvent.click(view.getByRole('button', { name: 'Save and connect' }));
    await expect(await connectedView(view)).toHaveTextContent(passcode);
    const start = mock?.calls.find((call) => call.line.includes('/start'));
    await expect(start?.body).toEqual({ token: 'new-token' });
  },
};

/** The start was accepted and ngrok has not answered yet: the progress is shown. */
export const Starting: Story = {
  beforeEach: install(idle, { outcome: 'hold' }),
  play: async () => {
    const view = within(document.body);
    await userEvent.type(await view.findByLabelText('ngrok auth token'), 'story-token');
    await userEvent.click(view.getByRole('button', { name: 'Save and connect' }));
    await waitFor(() => expect(view.getByRole('button', { name: 'Connecting…' })).toBeDisabled());
    await expect(await view.findByRole('status')).toHaveTextContent('Connecting to ngrok…');
    await expect(view.queryByDisplayValue('story-token')).toBeNull();
  },
};

/** ngrok could not be reached: the settings stay and a fixed reason is shown. */
export const StartFails: Story = {
  beforeEach: install(idle, { outcome: 'failed' }),
  play: async () => {
    const view = within(document.body);
    await userEvent.type(await view.findByLabelText('ngrok auth token'), 'story-token');
    await userEvent.click(view.getByRole('button', { name: 'Save and connect' }));
    await expect(await view.findByRole('alert', {}, { timeout: 5000 })).toHaveTextContent(
      'Could not connect to ngrok',
    );
    await expect(view.getByText('Not connected')).toBeInTheDocument();
    await expect(view.queryByDisplayValue('story-token')).toBeNull();
  },
};

/** The settings changed elsewhere: nothing is started and the person is told. */
export const SettingsConflict: Story = {
  beforeEach: install(idle, { conflict: true }),
  play: async () => {
    const view = within(document.body);
    await userEvent.type(await view.findByLabelText('ngrok auth token'), 'story-token');
    await userEvent.click(view.getByRole('button', { name: 'Save and connect' }));
    await expect(await view.findByRole('alert')).toHaveTextContent('settings changed');
    await expect(mock?.calls.some((call) => call.line.includes('/start'))).toBe(false);
  },
};

const typeToken = async (view: ReturnType<typeof within>, token: string) => {
  if (token) await userEvent.type(await view.findByLabelText('ngrok auth token'), token);
  else await view.findByLabelText('ngrok auth token');
};

/** The save box is off by default: a plain connect sends only the token. */
export const SaveBoxOffByDefault: Story = {
  beforeEach: install(idle),
  play: async () => {
    const view = within(document.body);
    await typeToken(view, 'story-token');
    await expect(saveBox(view)).not.toBeChecked();
    await userEvent.click(view.getByRole('button', { name: 'Save and connect' }));
    await waitFor(() =>
      expect(mock?.calls.some((call) => call.line.includes('/start'))).toBe(true),
    );
    const start = mock?.calls.find((call) => call.line.includes('/start'));
    await expect(start?.body).toEqual({ token: 'story-token' });
  },
};

/** With the box on, the start request carries save: true and the token never reaches the settings. */
export const SaveTokenToSecureStorage: Story = {
  beforeEach: install(idle),
  play: async () => {
    const view = within(document.body);
    await typeToken(view, 'story-token');
    await userEvent.click(saveBox(view));
    await userEvent.click(view.getByRole('button', { name: 'Save and connect' }));
    await expect(await connectedView(view)).toBeInTheDocument();
    const start = mock?.calls.find((call) => call.line.includes('/start'));
    await expect(start?.body).toEqual({ token: 'story-token', save: true });
    const save = mock?.calls.find((call) => call.line.startsWith('PUT'));
    await expect(JSON.stringify(save?.body)).not.toContain('story-token');
  },
};

const savedToken: ConnectionSnapshot = {
  ...idle,
  tokenConfigured: true,
  tokenSource: 'keychain',
  keychainTokenSaved: true,
  settings: { enabled: true },
};

/** A token saved on this PC is announced and can be deleted in the setup that the stopped view opens. */
export const DeleteSavedToken: Story = {
  beforeEach: install(savedToken),
  play: async () => {
    const view = within(document.body);
    await userEvent.click(await view.findByRole('button', { name: 'Change settings' }));
    await waitFor(() =>
      expect(view.getByTestId('token-note')).toHaveTextContent("Saved in this PC's secure storage"),
    );
    await userEvent.click(view.getByRole('button', { name: 'Delete the saved token' }));
    await waitFor(() =>
      expect(view.queryByRole('button', { name: 'Delete the saved token' })).toBeNull(),
    );
    await expect(mock?.calls.map((call) => call.line)).toContain(
      'DELETE /api/monitor-connections/token',
    );
    await expect(view.getByTestId('token-note')).toHaveTextContent(
      'used only while this app is running',
    );
  },
};

/** A saved token is enough: Reconnect starts the connection without a token body. */
export const ConnectWithSavedToken: Story = {
  beforeEach: install(savedToken),
  play: async () => {
    const view = within(document.body);
    await userEvent.click(await view.findByRole('button', { name: 'Reconnect' }));
    await expect(await connectedView(view)).toBeInTheDocument();
    const start = mock?.calls.find((call) => call.line.includes('/start'));
    await expect(start?.body).toBeUndefined();
  },
};

/** This PC has no secure storage: saving is off and disabled, and the note says to enter it each time. */
export const SecureStorageUnavailable: Story = {
  beforeEach: install({ ...idle, keychainAvailable: false }),
  play: async () => {
    const view = within(document.body);
    await waitFor(() =>
      expect(view.getByTestId('token-note')).toHaveTextContent('This PC cannot save the token'),
    );
    const box = saveBox(view);
    await expect(box).toBeDisabled();
    await expect(box).not.toBeChecked();
    // The note about saving describes a storage this PC does not have, so it is not shown.
    await expect(view.queryByText(/secure storage/)).toBeNull();
    await expect(view.queryByRole('button', { name: 'Delete the saved token' })).toBeNull();
  },
};

/** The secure storage refuses the save: nothing starts and the same plain message is shown. */
export const SecureStorageSaveRefused: Story = {
  beforeEach: install(idle, { saveFails: true }),
  play: async () => {
    const view = within(document.body);
    await typeToken(view, 'story-token');
    await userEvent.click(saveBox(view));
    await userEvent.click(view.getByRole('button', { name: 'Save and connect' }));
    await expect(await view.findByRole('alert')).toHaveTextContent('This PC cannot save the token');
  },
};

/** The token comes from the environment: it is announced, nothing can be deleted, and the box can stay off. */
export const TokenFromEnvironment: Story = {
  beforeEach: install({
    ...savedToken,
    tokenSource: 'env',
    keychainTokenSaved: false,
  }),
  play: async () => {
    const view = within(document.body);
    await waitFor(() =>
      expect(view.getByTestId('token-note')).toHaveTextContent('NGROK_AUTHTOKEN'),
    );
    await expect(view.queryByRole('button', { name: 'Delete the saved token' })).toBeNull();
    await expect(saveBox(view)).not.toBeChecked();
  },
};

/** The person turns the save box on while typing a token; nothing is sent yet. */
export const SaveBoxOn: Story = {
  beforeEach: install(idle),
  play: async () => {
    const view = within(document.body);
    await typeToken(view, 'story-token');
    const box = saveBox(view);
    await userEvent.click(box);
    await expect(box).toBeChecked();
    await expect(mock?.calls.some((call) => call.line.startsWith('PUT'))).toBe(false);
  },
};

/** A token saved on this PC is announced and the delete action is offered in the setup. */
export const SavedTokenForm: Story = {
  beforeEach: install(savedToken),
  play: async () => {
    const view = within(document.body);
    await userEvent.click(await view.findByRole('button', { name: 'Change settings' }));
    await waitFor(() =>
      expect(view.getByTestId('token-note')).toHaveTextContent("Saved in this PC's secure storage"),
    );
    await expect(view.getByRole('button', { name: 'Delete the saved token' })).toBeEnabled();
  },
};

/** No token anywhere and nothing typed: nothing is sent and the person is asked for one. */
export const TokenRequired: Story = {
  beforeEach: install(idle),
  play: async () => {
    const view = within(document.body);
    await typeToken(view, '');
    await userEvent.click(view.getByRole('button', { name: 'Save and connect' }));
    await expect(await view.findByRole('alert')).toHaveTextContent('Enter your ngrok auth token');
    await expect(mock?.calls.some((call) => call.line.startsWith('PUT'))).toBe(false);
  },
};
