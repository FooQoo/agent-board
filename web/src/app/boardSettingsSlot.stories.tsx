import { useRef, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { modalDocsParameters } from '../../.storybook/support/modal-docs';
import { DEFAULT_NOTIFICATION_SETTINGS } from '../features/notification-settings/model';
import { BoardSettings } from './BoardSettings';

const meta = {
  title: 'App/Board settings slot',
  component: BoardSettings,
  parameters: { layout: 'fullscreen', ...modalDocsParameters },
} satisfies Meta<typeof BoardSettings>;
export default meta;

/** The header's side of the slot: a settings button, and the state that opens the dialog. */
function Header(args: { open: boolean }) {
  const [open, setOpen] = useState(args.open);
  const button = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button type="button" ref={button} onClick={() => setOpen(true)}>
        Settings button
      </button>
      <BoardSettings open={open} onOpenChange={setOpen} restoreFocusRef={button} />
    </>
  );
}

/**
 * The connection entry sits below language and theme in the PC board's settings dialog. Choosing
 * it closes the settings dialog and opens the connection dialog alone; closing that returns the
 * focus to the settings button.
 */
export const WithConnectionEntry: StoryObj<typeof meta> = {
  args: { open: true, onOpenChange: () => {}, restoreFocusRef: { current: null } },
  render: (args) => <Header open={args.open} />,
  beforeEach: () => {
    // The page served on the PC carries its token; a page without one came through the entrance,
    // which shows no connection entry.
    const token = document.createElement('meta');
    token.name = 'agboard-token';
    token.content = 'story-token';
    document.head.append(token);
    const original = window.fetch;
    window.fetch = (input, init) => {
      if (String(input).startsWith('/api/notification-settings')) {
        return Promise.resolve(
          new Response(JSON.stringify(DEFAULT_NOTIFICATION_SETTINGS), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      if (!String(input).startsWith('/api/monitor-connections')) return original(input, init);
      return Promise.resolve(
        new Response(
          JSON.stringify({
            status: 'disabled',
            url: null,
            revision: 1,
            settings: { enabled: false },
            tokenConfigured: false,
            tokenSource: null,
            keychainAvailable: true,
            keychainTokenSaved: false,
            failure: null,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    };
    return () => {
      window.fetch = original;
      token.remove();
    };
  },
  play: async () => {
    const view = within(document.body);
    // 24 themes and 2 languages; the notification choices live in their own dialog.
    await waitFor(() => expect(view.getAllByRole('radio')).toHaveLength(26));
    await expect(await view.findByRole('button', { name: 'Notification settings' })).toBeVisible();
    await expect(view.getAllByRole('dialog', { hidden: true })).toHaveLength(1);
    await userEvent.click(await view.findByRole('button', { name: 'Connection settings' }));
    // The settings dialog is gone and the connection dialog is the only one on the screen.
    await waitFor(() => expect(view.queryAllByRole('radio')).toHaveLength(0));
    await waitFor(() => expect(view.getAllByRole('dialog', { hidden: true })).toHaveLength(1));
    await expect(await view.findByRole('heading', { name: 'Remote connection' })).toBeVisible();
    await expect(await view.findByLabelText('ngrok auth token')).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(view.queryAllByRole('dialog', { hidden: true })).toHaveLength(0));
    await waitFor(() =>
      expect(view.getByRole('button', { name: 'Settings button' })).toHaveFocus(),
    );
  },
};
