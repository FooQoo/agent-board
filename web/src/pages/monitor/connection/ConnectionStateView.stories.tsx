import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { ConnectionStateView } from './ConnectionStateView';

const meta = {
  title: 'Pages/Monitor connection state',
  component: ConnectionStateView,
  parameters: { storyFrame: 'monitor', layout: 'fullscreen' },
  globals: { width: 'phone-375' },
  args: { status: 'needs_passcode', onSubmit: fn() },
} satisfies Meta<typeof ConnectionStateView>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The passcode is needed: four digits are typed and sent; nothing is sent before they are all there. */
export const EnterPasscode: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { name: 'Enter the passcode' })).toBeVisible();
    const input = canvas.getByLabelText('Passcode');
    const connect = canvas.getByRole('button', { name: 'Connect' });
    await expect(connect).toBeDisabled();
    await userEvent.type(input, '48a2');
    // Only digits are kept, at most four.
    await expect(input).toHaveValue('482');
    await expect(connect).toBeDisabled();
    await userEvent.type(input, '19');
    await expect(input).toHaveValue('4821');
    await userEvent.click(connect);
    await expect(args.onSubmit).toHaveBeenCalledWith('4821');
  },
};

/** The numeric keyboard is asked for, and the field is not offered for autofill. */
export const NumericKeyboard: Story = {
  play: async ({ canvasElement }) => {
    const input = within(canvasElement).getByLabelText('Passcode');
    await expect(input).toHaveAttribute('inputmode', 'numeric');
    await expect(input).toHaveAttribute('autocomplete', 'off');
  },
};

/** The passcode is being checked, so it cannot be sent twice. */
export const Checking: Story = {
  args: { checking: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: 'Checking…' })).toBeDisabled();
    await expect(canvas.getByLabelText('Passcode')).toBeDisabled();
  },
};

/** The last passcode was not accepted; the message says so without a count of tries. */
export const PasscodeRefused: Story = {
  args: { error: 'The passcode was not accepted.\nCheck the digits shown on your PC.' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('alert')).toHaveTextContent('was not accepted');
    await expect(canvas.getByLabelText('Passcode')).toBeEnabled();
  },
};

/** Too many wrong passcodes: the form is closed and the PC has to start the connection again. */
export const Locked: Story = {
  args: {
    locked: true,
    error: 'Too many wrong passcodes.\nStop and start the connection on the PC to get a new one.',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('alert')).toHaveTextContent('Too many wrong passcodes');
    await expect(canvas.getByLabelText('Passcode')).toBeDisabled();
    await expect(canvas.getByRole('button', { name: 'Connect' })).toBeDisabled();
  },
};

/** The app session ended and could not be renewed: the message says so above the form. */
export const SessionExpired: Story = {
  args: { error: 'The connection has ended.\nEnter the passcode again.' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('alert')).toHaveTextContent('The connection has ended');
    await expect(canvas.getByLabelText('Passcode')).toBeEnabled();
  },
};

/** The connection is stopped on the PC. */
export const ConnectionStopped: Story = {
  args: { error: 'The connection is stopped.\nCheck the PC.' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('alert')).toHaveTextContent(
      'The connection is stopped',
    );
  },
};

/** The monitor could not be reached and the cause is unknown: the form stays available. */
export const MonitorUnreachable: Story = {
  args: { error: 'Could not reach the monitor.\nCheck the connection and try again.' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('alert')).toHaveTextContent('Could not reach the monitor');
    await expect(canvas.getByLabelText('Passcode')).toBeVisible();
  },
};

/** The PC connection dropped; there is no form, the phone waits. */
export const WaitingForRecovery: Story = {
  args: { status: 'reconnecting' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { name: 'Reconnecting' })).toBeVisible();
    await expect(canvas.queryByLabelText('Passcode')).toBeNull();
    await expect(canvas.queryByRole('button', { name: 'Connect' })).toBeNull();
  },
};

/** The same screen at the narrowest supported phone width. */
export const NarrowPhone: Story = {
  globals: { width: 'phone-320' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole('button', { name: 'Connect' });
    const input = canvas.getByLabelText('Passcode');
    const frame = canvasElement.closest('[data-story-width]') ?? canvasElement;
    const edge = frame.getBoundingClientRect().right;
    await expect(button.getBoundingClientRect().right).toBeLessThanOrEqual(edge);
    await expect(input.getBoundingClientRect().right).toBeLessThanOrEqual(edge);
  },
};

/** A wrong passcode keeps what was typed so that one digit can be fixed. */
export const KeepsTypedDigits: Story = {
  render: function Render(args) {
    const [error, setError] = useState<string | null>(null);
    return (
      <ConnectionStateView
        {...args}
        error={error}
        onSubmit={() =>
          setError('The passcode was not accepted.\nCheck the digits shown on your PC.')
        }
      />
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText('Passcode'), '1234');
    await userEvent.click(canvas.getByRole('button', { name: 'Connect' }));
    await expect(await canvas.findByRole('alert')).toHaveTextContent('was not accepted');
    await expect(canvas.getByLabelText('Passcode')).toHaveValue('1234');
  },
};
