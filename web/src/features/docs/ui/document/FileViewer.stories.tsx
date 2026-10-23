import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor, within } from 'storybook/test';
import { FileViewer } from './FileViewer';

const meta = {
  title: 'Docs/Document/FileViewer',
  component: FileViewer,
  decorators: [
    (Story) => (
      <div style={{ width: 480, padding: 16 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof FileViewer>;

export default meta;
type Story = StoryObj<typeof meta>;

/** An image is shown at its own size, and no wider than its frame. */
export const Image: Story = {
  args: { kind: 'image', name: 'sample-attachment.png', src: '/sample-attachment.png' },
  play: async ({ canvasElement }) => {
    const image = await within(canvasElement).findByAltText('sample-attachment.png');
    await waitFor(() => expect(image).toBeVisible());
    await expect(image.getBoundingClientRect().width).toBeLessThanOrEqual(480);
  },
};

/** An image that cannot be loaded says so and names the file. */
export const ImageFailed: Story = {
  args: { kind: 'image', name: 'missing.png', src: '/does-not-exist.png' },
  play: async ({ canvasElement }) => {
    const view = within(canvasElement);
    await expect(await view.findByText('Could not load the image')).toBeVisible();
    await expect(view.getByText('missing.png')).toBeVisible();
  },
};

/** A file the docs do not show: the notice and the file's name. */
export const Other: Story = {
  args: { kind: 'other', name: 'board.pen' },
  play: async ({ canvasElement }) => {
    const view = within(canvasElement);
    await expect(view.getByText('This file type cannot be shown here.')).toBeVisible();
    await expect(view.getByText('board.pen')).toBeVisible();
  },
};
