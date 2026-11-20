import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { SAMPLE_IMAGE_URL } from '../../../../.storybook/support/fixtures';
import { Lightbox } from './Lightbox';

const meta = {
  title: 'Shared/UI/Lightbox',
  component: Lightbox,
  args: { label: 'Sample picture', onClose: fn(), children: null },
} satisfies Meta<typeof Lightbox>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The enlarged picture: a dialog named after the picture, with a close control and the picture. */
export const Picture: Story = {
  render: (args) => (
    <Lightbox {...args}>
      <img src={SAMPLE_IMAGE_URL} alt="Synthetic sample" />
    </Lightbox>
  ),
  play: async () => {
    const dialog = await within(document.body).findByRole('dialog', { name: 'Sample picture' });
    expect(dialog.hasAttribute('data-lightbox')).toBe(true);
    expect(within(dialog).getByRole('img', { name: 'Synthetic sample' })).toBeInTheDocument();
  },
};

/** The close control, or Escape, asks the owner to close: the picture itself is not removed here. */
export const CloseCalls: Story = {
  render: (args) => (
    <Lightbox {...args}>
      <img src={SAMPLE_IMAGE_URL} alt="Synthetic sample" />
    </Lightbox>
  ),
  play: async ({ args }) => {
    const dialog = await within(document.body).findByRole('dialog', { name: 'Sample picture' });
    await userEvent.click(within(dialog).getByRole('button', { name: /close/i }));
    expect(args.onClose).toHaveBeenCalledTimes(1);
  },
};

/** Escape, and a press on the dim backdrop outside the picture, ask the owner to close too. */
export const CloseByEscapeAndBackdrop: Story = {
  render: (args) => (
    <Lightbox {...args}>
      <img src={SAMPLE_IMAGE_URL} alt="Synthetic sample" />
    </Lightbox>
  ),
  play: async ({ args }) => {
    await within(document.body).findByRole('dialog', { name: 'Sample picture' });
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(args.onClose).toHaveBeenCalledTimes(1));
    const overlay = document.querySelector('[data-slot="dialog-overlay"]') as HTMLElement;
    await userEvent.pointer([
      { target: overlay, coords: { clientX: 2, clientY: 2 } },
      { keys: '[MouseLeft]', target: overlay, coords: { clientX: 2, clientY: 2 } },
    ]);
    await waitFor(() => expect(args.onClose).toHaveBeenCalledTimes(2));
  },
};
