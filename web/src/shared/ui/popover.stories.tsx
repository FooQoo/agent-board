import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { Button } from './button';
import { Popover, PopoverContent, PopoverTrigger } from './popover';

const meta = {
  title: 'Shared/UI/Popover',
  component: Popover,
} satisfies Meta<typeof Popover>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The popover content, with a short text and the trigger that opens it. */
function SamplePopover({
  defaultOpen = false,
  align,
}: {
  defaultOpen?: boolean;
  align?: 'start' | 'center' | 'end';
}) {
  return (
    <Popover defaultOpen={defaultOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline">Show details</Button>
      </PopoverTrigger>
      <PopoverContent align={align}>
        <p>Synthetic popover text for the Story.</p>
      </PopoverContent>
    </Popover>
  );
}

export const Closed: Story = {
  render: () => <SamplePopover />,
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('button', { name: 'Show details' }),
    ).toHaveAttribute('aria-expanded', 'false');
    await expect(within(document.body).queryByRole('dialog')).toBeNull();
  },
};

/** A click opens the content into the document body, and the trigger reports that it is expanded. */
export const OpenedByClick: Story = {
  render: () => <SamplePopover />,
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole('button', { name: 'Show details' });
    await userEvent.click(trigger);
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(
      within(document.body).getByText('Synthetic popover text for the Story.'),
    ).toBeInTheDocument();
  },
};

/** Escape closes the content and gives the focus back to the trigger. */
export const EscapeRestoresFocus: Story = {
  render: () => <SamplePopover />,
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole('button', { name: 'Show details' });
    await userEvent.click(trigger);
    await userEvent.keyboard('{Escape}');
    await expect(within(document.body).queryByRole('dialog')).toBeNull();
    await expect(trigger).toHaveFocus();
  },
};

/** The content is open at first, and the alignment prop moves it relative to the trigger. */
export const OpenStartAligned: Story = {
  render: () => <SamplePopover defaultOpen align="start" />,
  play: async () => {
    await expect(
      within(document.body).getByText('Synthetic popover text for the Story.'),
    ).toBeInTheDocument();
  },
};
