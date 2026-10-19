import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { ACCENTS, MODES, selectTheme } from '../theme';
import { createMemoryStorage } from '../../../.storybook/support/decorators';
import { Button } from './button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './dialog';

/** Waits until a theme change has reached the computed styles: one frame, then the CSS transitions it started. */
async function settleTheme(): Promise<void> {
  await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  await Promise.all(
    document.getAnimations().map((animation) => animation.finished.catch(() => {})),
  );
}

const meta = {
  title: 'Shared/UI/Dialog',
  component: Dialog,
} satisfies Meta<typeof Dialog>;

export default meta;
type Story = StoryObj<typeof meta>;

function SampleContent({
  showCloseButton = true,
  footerClose = false,
}: {
  showCloseButton?: boolean;
  footerClose?: boolean;
}) {
  return (
    <DialogContent showCloseButton={showCloseButton}>
      <DialogHeader>
        <DialogTitle>Sample dialog</DialogTitle>
        <DialogDescription>A synthetic dialog that the Story opens.</DialogDescription>
      </DialogHeader>
      <DialogFooter showCloseButton={footerClose}>
        <DialogClose asChild>
          <Button variant="outline">Cancel</Button>
        </DialogClose>
      </DialogFooter>
    </DialogContent>
  );
}

/** The closed dialog: a click opens it, and the content is rendered into the document body. */
export const Trigger: Story = {
  render: () => (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline">Open dialog</Button>
      </DialogTrigger>
      <SampleContent />
    </Dialog>
  ),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Open dialog' }));
    const dialog = within(document.body).getByRole('dialog', { name: 'Sample dialog' });
    expect(dialog).toBeInTheDocument();
    expect(canvasElement.contains(dialog)).toBe(false);
  },
};

/** The open dialog as it is first shown: its title, description, footer and close control. */
export const Open: Story = {
  render: () => (
    <Dialog defaultOpen>
      <SampleContent />
    </Dialog>
  ),
  play: async () => {
    expect(
      within(document.body).getByRole('dialog', { name: 'Sample dialog' }),
    ).toBeInTheDocument();
  },
};

/** Escape closes the dialog and the focus goes back to the trigger that opened it. */
export const EscapeRestoresFocus: Story = {
  render: () => (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline">Open dialog</Button>
      </DialogTrigger>
      <SampleContent />
    </Dialog>
  ),
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole('button', { name: 'Open dialog' });
    await userEvent.click(trigger);
    await expect(
      within(document.body).getByRole('dialog', { name: 'Sample dialog' }),
    ).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    // The dialog leaves after its closing animation, and the focus returns once it has gone.
    await waitFor(() => expect(within(document.body).queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(trigger).toHaveFocus());
  },
};

/** The corner close control has the accessible name "Close" and closes the dialog. */
export const CloseIconDismisses: Story = {
  render: () => (
    <Dialog defaultOpen>
      <SampleContent />
    </Dialog>
  ),
  play: async () => {
    await userEvent.click(within(document.body).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(within(document.body).queryByRole('dialog')).toBeNull());
  },
};

/** Without the corner control the dialog still closes through its footer button. */
export const WithoutCloseIcon: Story = {
  render: () => (
    <Dialog defaultOpen>
      <SampleContent showCloseButton={false} />
    </Dialog>
  ),
  play: async () => {
    await expect(within(document.body).queryByRole('button', { name: 'Close' })).toBeNull();
    await userEvent.click(within(document.body).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(within(document.body).queryByRole('dialog')).toBeNull());
  },
};

/** The footer can add its own "Close" button, which closes the dialog as well. */
export const FooterCloseButton: Story = {
  render: () => (
    <Dialog defaultOpen>
      <SampleContent footerClose />
    </Dialog>
  ),
  play: async () => {
    await expect(within(document.body).getAllByRole('button', { name: 'Close' })).toHaveLength(2);
  },
};

/**
 * The portal shares the theme of the page: the accent variable inside the dialog equals the one in
 * the page, for all 12 accents in light and dark. The dialog is rendered into the document body.
 */
export const PortalFollowsTheme: Story = {
  render: () => (
    <Dialog defaultOpen>
      <DialogTrigger asChild>
        <Button variant="outline">Trigger in page</Button>
      </DialogTrigger>
      <SampleContent />
    </Dialog>
  ),
  play: async ({ canvasElement }) => {
    // The open dialog hides the page from role queries, so the trigger is found by its text.
    const trigger = within(canvasElement).getByText('Trigger in page');
    const content = within(document.body).getByRole('dialog', { name: 'Sample dialog' });
    for (const mode of MODES) {
      for (const accent of ACCENTS) {
        selectTheme({ mode, accent }, createMemoryStorage);
        await settleTheme();
        const inPage = getComputedStyle(trigger).getPropertyValue('--r-accent').trim();
        const inPortal = getComputedStyle(content).getPropertyValue('--r-accent').trim();
        expect(inPortal, `${mode}/${accent}`).not.toBe('');
        expect(inPortal, `${mode}/${accent}`).toBe(inPage);
        expect(getComputedStyle(content).backgroundColor, `${mode}/${accent}`).not.toBe(
          'rgba(0, 0, 0, 0)',
        );
      }
    }
  },
};
