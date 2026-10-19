import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';
import { CollapsibleSection } from './CollapsibleSection';

const meta = {
  title: 'Editor/CollapsibleSection',
  component: CollapsibleSection,
  args: {
    title: 'Image attachments',
    count: 2,
    open: true,
    onToggle: () => {},
    children: <p>Attachment panel content stays mounted while folded.</p>,
  },
} satisfies Meta<typeof CollapsibleSection>;

export default meta;
type Story = StoryObj<typeof meta>;

function CollapsibleHost() {
  const [open, setOpen] = useState(true);
  return (
    <CollapsibleSection
      title="Image attachments"
      count={2}
      open={open}
      onToggle={() => setOpen((value) => !value)}
    >
      <p>Attachment panel content stays mounted while folded.</p>
    </CollapsibleSection>
  );
}

export const FoldAndKeepContent: Story = {
  render: () => <CollapsibleHost />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const toggle = canvas.getByRole('button', { name: /Image attachments/ });
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(toggle);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    const body = canvasElement.querySelector('.collapsible__body');
    await expect(body).not.toBeNull();
    await expect(body).toHaveAttribute('hidden');
    await expect(body).toHaveTextContent('Attachment panel content stays mounted while folded');
  },
};
