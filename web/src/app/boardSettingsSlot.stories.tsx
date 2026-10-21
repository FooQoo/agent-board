import { useRef, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { modalDocsParameters } from '../../.storybook/support/modal-docs';
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
    const original = window.fetch;
    window.fetch = (input, init) => {
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
    };
  },
  play: async () => {
    const view = within(document.body);
    await expect(view.getAllByRole('radio')).toHaveLength(26);
    await expect(view.getAllByRole('dialog', { hidden: true })).toHaveLength(1);
    await userEvent.click(await view.findByRole('button', { name: 'Set up' }));
    // The settings dialog is gone and the connection dialog is the only one on the screen.
    await waitFor(() => expect(view.queryAllByRole('radio')).toHaveLength(0));
    await waitFor(() => expect(view.getAllByRole('dialog', { hidden: true })).toHaveLength(1));
    await expect(await view.findByRole('heading', { name: 'Mobile connection' })).toBeVisible();
    await expect(await view.findByLabelText('ngrok auth token')).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(view.queryAllByRole('dialog', { hidden: true })).toHaveLength(0));
    await waitFor(() =>
      expect(view.getByRole('button', { name: 'Settings button' })).toHaveFocus(),
    );
  },
};
