import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { Dialog, DialogContent, DialogTitle } from '../dialog';
import { StalePageNotice } from './StalePageNotice';

const meta = {
  title: 'Shared/UI/StalePageNotice',
  component: StalePageNotice,
} satisfies Meta<typeof StalePageNotice>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The banner is rendered at the body, so it is outside the Story's canvas. It says the page is out of
 * date and offers a reload. The reload is not clicked here: it would reload the Story itself.
 */
export const Default: Story = {
  play: async () => {
    const alert = within(document.body).getByRole('alert');
    await expect(alert).toHaveTextContent('This page is out of date');
    await expect(within(alert).getByRole('button', { name: 'Reload page' })).toBeEnabled();
  },
};

/** The banner stays above an open dialog, so the reload can be reached while the dialog is open. */
export const AboveOpenDialog: Story = {
  render: () => (
    <>
      <Dialog defaultOpen>
        <DialogContent>
          <DialogTitle>Sample dialog</DialogTitle>
        </DialogContent>
      </Dialog>
      <StalePageNotice />
    </>
  ),
  play: async () => {
    await expect(
      within(document.body).getByRole('dialog', { name: 'Sample dialog' }),
    ).toBeInTheDocument();
    // The open dialog hides the page from role queries, so the alert is found with hidden elements included.
    const alert = within(document.body).getByRole('alert', { hidden: true });
    await expect(getComputedStyle(alert).zIndex).toBe('1000');
    await expect(getComputedStyle(alert).pointerEvents).toBe('auto');
  },
};
