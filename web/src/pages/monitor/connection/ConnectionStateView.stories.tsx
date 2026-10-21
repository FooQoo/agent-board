import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { ConnectionStateView } from './ConnectionStateView';

const meta = {
  title: 'Pages/Monitor connection state',
  component: ConnectionStateView,
  parameters: { storyFrame: 'monitor', layout: 'fullscreen' },
  globals: { width: 'phone-375' },
  args: { status: 'needs_google', onConnect: fn() },
} satisfies Meta<typeof ConnectionStateView>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Google sign-in is needed again: one action goes to Google. */
export const GoogleReconnect: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { name: 'Reconnect with Google' })).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Reconnect with Google' }));
    await expect(args.onConnect).toHaveBeenCalled();
  },
};

/** The page is moving to Google, so the action cannot be pressed twice. */
export const OpeningGoogle: Story = {
  args: { saving: true },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('button', { name: 'Opening Google…' }),
    ).toBeDisabled();
  },
};

/** The last attempt failed and says so above the action. */
export const GoogleFailed: Story = {
  args: { error: 'Could not reach Google. Try again.' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('alert')).toHaveTextContent(
      'Could not reach Google',
    );
  },
};

/** The app session ended and could not be renewed: the message says so above the action. */
export const SessionExpired: Story = {
  args: { error: 'The connection has ended. Reconnect with Google.' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('alert')).toHaveTextContent('The connection has ended');
    await expect(canvas.getByRole('button', { name: 'Reconnect with Google' })).toBeEnabled();
  },
};

/** The connection is stopped, or the allowed account or address changed. */
export const ConnectionStopped: Story = {
  args: { error: 'The connection is stopped or no longer allowed.\nCheck the PC.' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('alert')).toHaveTextContent(
      'stopped or no longer allowed',
    );
  },
};

/** The monitor could not be reached and the cause is unknown: the action stays available. */
export const MonitorUnreachable: Story = {
  args: { error: 'Could not reach the monitor.\nCheck the connection and try again.' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('alert')).toHaveTextContent('Could not reach the monitor');
    await expect(canvas.getByRole('button', { name: 'Reconnect with Google' })).toBeVisible();
  },
};

/** The PC connection dropped; there is no action, the phone waits. */
export const WaitingForRecovery: Story = {
  args: { status: 'reconnecting' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { name: 'Reconnecting' })).toBeVisible();
    await expect(canvas.queryByRole('button', { name: /Google/ })).toBeNull();
  },
};

/** The same screen at the narrowest supported phone width. */
export const NarrowPhone: Story = {
  globals: { width: 'phone-320' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole('button', { name: 'Reconnect with Google' });
    const frame = canvasElement.closest('[data-story-width]') ?? canvasElement;
    await expect(button.getBoundingClientRect().right).toBeLessThanOrEqual(
      frame.getBoundingClientRect().right,
    );
  },
};
