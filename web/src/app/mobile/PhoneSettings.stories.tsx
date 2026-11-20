import { useRef, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { modalDocsParameters } from '../../../.storybook/support/modal-docs';
import { onTutorialRequest } from '../onboarding/tutorialRequest';
import { snapshotOf } from '../../features/resident-sessions/fixtures';
import { ResidentEntryRow } from '../../features/resident-sessions/ui/ResidentEntryRow';
import {
  requestResidentDialog,
  onResidentDialogRequest,
} from '../../features/resident-sessions/events';
import {
  requestNotificationDialog,
  onNotificationDialogRequest,
} from '../../features/notification-settings/events';
import { NotificationEntryRow } from '../../features/notification-settings/ui/NotificationEntryRow';
import { PhoneSettings } from './PhoneSettings';

const meta = {
  title: 'App/Mobile/Phone settings',
  component: PhoneSettings,
  parameters: {
    layout: 'fullscreen',
    viewport: { defaultViewport: 'mobile' },
    ...modalDocsParameters,
  },
} satisfies Meta<typeof PhoneSettings>;
export default meta;

/** The header's side of the slot: a settings button, and the state that opens the dialog. */
function Header(args: { open: boolean; resident?: boolean; notification?: boolean }) {
  const [open, setOpen] = useState(args.open);
  const button = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button type="button" ref={button} onClick={() => setOpen(true)}>
        Settings button
      </button>
      <PhoneSettings
        open={open}
        onOpenChange={setOpen}
        restoreFocusRef={button}
        residentRow={
          args.resident ? (
            <ResidentEntryRow
              snapshot={snapshotOf({ state: 'failed', tool: 'codex' })}
              onOpen={() => {
                setOpen(false);
                requestResidentDialog();
              }}
            />
          ) : undefined
        }
        notificationRow={
          args.notification ? (
            <NotificationEntryRow
              onOpen={() => {
                setOpen(false);
                requestNotificationDialog();
              }}
            />
          ) : undefined
        }
      />
    </>
  );
}

/**
 * The phone screen's settings offer the guide again below language and theme, as on the PC
 * board. Choosing it closes the dialog and asks the guide to start.
 */
export const WithTutorialEntry: StoryObj<typeof meta> = {
  args: { open: true, onOpenChange: () => {}, restoreFocusRef: { current: null } },
  render: (args) => <Header open={args.open} />,
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const dialog = await body.findByRole('dialog');
    const start = within(dialog).getByRole('button', { name: /Try it|試してみる/ });
    let requested = 0;
    const stop = onTutorialRequest(() => {
      requested += 1;
    });
    try {
      await userEvent.click(start);
      await waitFor(() => expect(body.queryByRole('dialog')).toBeNull());
      expect(requested).toBe(1);
    } finally {
      stop();
    }
  },
};

/**
 * The resident-session row below the tutorial, with a one-line summary. Choosing it closes the
 * settings and asks for the dialog, which the board shows as a bottom sheet at this width.
 */
export const WithResidentEntry: StoryObj<typeof meta> = {
  args: { open: true, onOpenChange: () => {}, restoreFocusRef: { current: null } },
  render: (args) => <Header open={args.open} resident />,
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const dialog = await body.findByRole('dialog');
    // The sheet fades in, so wait until the summary is visible rather than asserting at once.
    await waitFor(() => expect(within(dialog).getByText('Codex · failed')).toBeVisible());
    let requested = 0;
    const stop = onResidentDialogRequest(() => {
      requested += 1;
    });
    try {
      await userEvent.click(
        within(dialog).getByRole('button', { name: 'Agent settings' }),
      );
      await waitFor(() => expect(body.queryByRole('dialog')).toBeNull());
      expect(requested).toBe(1);
    } finally {
      stop();
    }
  },
};

/**
 * The notifications row below the resident-session row. Choosing it closes the settings and
 * asks for the dialog, which holds the notification choices and, on the Home Screen app, the
 * control that turns notifications on.
 */
export const WithNotificationEntry: StoryObj<typeof meta> = {
  args: { open: true, onOpenChange: () => {}, restoreFocusRef: { current: null } },
  render: (args) => <Header open={args.open} notification />,
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const dialog = await body.findByRole('dialog');
    // The settings no longer list the notification choices themselves.
    await expect(within(dialog).queryByRole('checkbox')).toBeNull();
    let requested = 0;
    const stop = onNotificationDialogRequest(() => {
      requested += 1;
    });
    try {
      await userEvent.click(within(dialog).getByRole('button', { name: 'Notification settings' }));
      await waitFor(() => expect(body.queryByRole('dialog')).toBeNull());
      expect(requested).toBe(1);
    } finally {
      stop();
    }
  },
};
