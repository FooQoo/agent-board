import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { modalDocsParameters } from '../../.storybook/support/modal-docs';
import { ConnectionSettings } from '../features/monitor-connections/ui/ConnectionSettings';
import { SettingsDialog } from '../features/settings/ui/SettingsDialog';

const meta = {
  title: 'App/Board settings slot',
  component: SettingsDialog,
  parameters: { layout: 'fullscreen', ...modalDocsParameters },
} satisfies Meta<typeof SettingsDialog>;
export default meta;

/** The connection entry sits below language and theme in the PC board's settings dialog. */
export const WithConnectionEntry: StoryObj<typeof meta> = {
  args: { open: true, onOpenChange: () => {} },
  render: (args) => <SettingsDialog {...args} extra={<ConnectionSettings />} />,
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
            settings: { enabled: false, allowEmails: [], domain: null, oauthApp: 'managed' },
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
    await expect(await view.findByRole('button', { name: 'Set up' })).toBeEnabled();
    await userEvent.click(view.getByRole('button', { name: 'Set up' }));
    await expect(view.getAllByRole('dialog', { hidden: true })).toHaveLength(2);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(view.getAllByRole('dialog', { hidden: true })).toHaveLength(1));
  },
};
