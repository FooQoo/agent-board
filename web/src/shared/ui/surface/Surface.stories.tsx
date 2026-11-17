import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { Button } from '../button';
import { Surface } from './Surface';

function Body() {
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {Array.from({ length: 14 }, (_, index) => (
        <p key={index}>
          Paragraph {index + 1}: a long body scrolls while the buttons stay in view.
        </p>
      ))}
    </div>
  );
}

const meta = {
  title: 'Shared/UI/Surface',
  component: Surface,
  args: {
    kind: 'dialog',
    title: 'Messages',
    closeLabel: 'Close',
    onClose: fn(),
    footer: <Button type="button">Send</Button>,
    children: <Body />,
  },
} satisfies Meta<typeof Surface>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A modal on the desktop board. */
export const Dialog: Story = {
  play: async ({ args, canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    await expect(await screen.findByRole('dialog', { name: 'Messages' })).toBeVisible();
    await expect(screen.getByRole('button', { name: 'Send' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    await expect(args.onClose).toHaveBeenCalled();
  },
};

/** A bottom sheet on a phone. */
export const Sheet: Story = {
  args: { kind: 'sheet', identity: 'Question' },
  globals: { viewport: { value: 'mobile1' } },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    await expect(await screen.findByRole('dialog', { name: 'Messages' })).toBeVisible();
    await expect(screen.getByRole('button', { name: 'Send' })).toBeVisible();
  },
};
