import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { Badge } from './badge';
import { Button } from './button';
import { Drawer } from './drawer';

const DRAWER_TITLE = 'Sample task';

/** A trigger and the drawer it opens. The open state lives here, as it does in the monitor. */
function DrawerDemo({
  initialOpen = false,
  withLabel = false,
  longBody = false,
  onOpenChange,
}: {
  initialOpen?: boolean;
  withLabel?: boolean;
  longBody?: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(initialOpen);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Open details
      </Button>
      <Drawer
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          onOpenChange(next);
        }}
        identity="#42"
        title={DRAWER_TITLE}
        label={withLabel ? <Badge>Doing</Badge> : undefined}
      >
        <div style={{ padding: '12px 16px', display: 'grid', gap: 12 }}>
          <p>A synthetic body for the drawer.</p>
          {longBody &&
            Array.from({ length: 12 }, (_, index) => (
              <p key={index}>
                Paragraph {index + 1}: the long body keeps the sheet scrollable inside its frame.
              </p>
            ))}
        </div>
      </Drawer>
    </>
  );
}

const meta = {
  title: 'Shared/UI/Drawer',
  component: DrawerDemo,
  args: { onOpenChange: fn() },
  // The drawer is the monitor's sheet, so the monitor stylesheet is loaded for these Stories.
  parameters: { storyFrame: 'monitor' },
} satisfies Meta<typeof DrawerDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Closed, the sheet is not in the document. The trigger opens it as a modal dialog named by its title. */
export const Closed: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(document.body).queryByRole('dialog')).toBeNull();
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Open details' }));
    await expect(
      within(document.body).getByRole('dialog', { name: DRAWER_TITLE }),
    ).toBeInTheDocument();
  },
};

export const OpenAtStart: Story = {
  args: { initialOpen: true },
  play: async () => {
    await expect(
      within(document.body).getByRole('dialog', { name: DRAWER_TITLE }),
    ).toBeInTheDocument();
    await expect(within(document.body).getByText('#42')).toBeInTheDocument();
  },
};

/** Escape closes the sheet, reports the change, and gives the focus back to the trigger. */
export const EscapeCloses: Story = {
  play: async ({ args, canvasElement }) => {
    const trigger = within(canvasElement).getByRole('button', { name: 'Open details' });
    await userEvent.click(trigger);
    await userEvent.keyboard('{Escape}');
    await expect(args.onOpenChange).toHaveBeenLastCalledWith(false);
    // The sheet leaves after its closing animation, and the focus returns once it has gone.
    await waitFor(() => expect(within(document.body).queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(trigger).toHaveFocus());
  },
};

/** The close button in the header dismisses the sheet. */
export const CloseButtonDismisses: Story = {
  args: { initialOpen: true },
  play: async ({ args }) => {
    await userEvent.click(within(document.body).getByRole('button', { name: 'Close details' }));
    await expect(args.onOpenChange).toHaveBeenCalledWith(false);
  },
};

/** The handle takes the arrow-down key as the swipe-down gesture would, and dismisses the sheet. */
export const HandleArrowDownDismisses: Story = {
  args: { initialOpen: true },
  play: async ({ args }) => {
    const handle = within(document.body).getByRole('button', {
      name: 'Swipe down to close details',
    });
    handle.focus();
    await userEvent.keyboard('{ArrowDown}');
    await expect(args.onOpenChange).toHaveBeenCalledWith(false);
  },
};

/** The status label sits under the title, and the sheet keeps the title as its accessible name. */
export const WithLabel: Story = {
  args: { initialOpen: true, withLabel: true },
  play: async () => {
    await expect(
      within(document.body).getByRole('dialog', { name: DRAWER_TITLE }),
    ).toBeInTheDocument();
    await expect(within(document.body).getByText('Doing')).toBeInTheDocument();
  },
};

/** A long body stays inside the sheet, and the handle and header stay in place above it. */
export const LongBody: Story = {
  args: { initialOpen: true, longBody: true },
  play: async () => {
    await expect(
      within(document.body).getByText(
        'Paragraph 12: the long body keeps the sheet scrollable inside its frame.',
      ),
    ).toBeInTheDocument();
  },
};
