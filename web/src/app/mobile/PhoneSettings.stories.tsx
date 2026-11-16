import { useRef, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { modalDocsParameters } from '../../../.storybook/support/modal-docs';
import { onTutorialRequest } from '../onboarding/tutorialRequest';
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
function Header(args: { open: boolean }) {
  const [open, setOpen] = useState(args.open);
  const button = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button type="button" ref={button} onClick={() => setOpen(true)}>
        Settings button
      </button>
      <PhoneSettings open={open} onOpenChange={setOpen} restoreFocusRef={button} />
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
