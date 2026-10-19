import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
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

const meta = {
  title: 'Shared/UI/Dialog',
  component: Dialog,
} satisfies Meta<typeof Dialog>;

export default meta;
type Story = StoryObj<typeof meta>;

function SampleContent() {
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Sample dialog</DialogTitle>
        <DialogDescription>A synthetic dialog that the Story opens.</DialogDescription>
      </DialogHeader>
      <DialogFooter>
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
