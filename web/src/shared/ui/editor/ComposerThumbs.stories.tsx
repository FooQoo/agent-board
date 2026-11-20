import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import type { EditorAttachment } from './attachmentTypes';
import { ComposerThumbs } from './ComposerThumbs';

const picture = (fill: string) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" fill="${fill}"/></svg>`,
  )}`;

const images: EditorAttachment[] = [
  {
    id: 'a',
    name: 'screen-a.png',
    mediaType: 'image/png',
    size: 2048,
    url: picture('#2563eb'),
    source: 'local',
  },
  {
    id: 'b',
    name: 'screen-b.png',
    mediaType: 'image/png',
    size: 4096,
    url: picture('#16a34a'),
    source: 'local',
  },
];

function ThumbsHost() {
  const [items, setItems] = useState(images);
  return (
    <ComposerThumbs
      attachments={items}
      label="Attached images"
      removeLabel={(name) => `Remove ${name}`}
      onRemove={(id) => setItems((list) => list.filter((item) => item.id !== id))}
    />
  );
}

const meta = {
  title: 'Editor/ComposerThumbs',
  component: ComposerThumbs,
  args: {
    attachments: images,
    label: 'Attached images',
    removeLabel: (name: string) => `Remove ${name}`,
    onRemove: () => {},
  },
} satisfies Meta<typeof ComposerThumbs>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A tap on a thumbnail opens the viewer, and the remove button drops only that picture. */
export const PreviewAndRemove: Story = {
  render: () => <ThumbsHost />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const list = canvas.getByRole('list', { name: 'Attached images' });
    await expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    await userEvent.click(canvas.getByRole('button', { name: 'Remove screen-b.png' }));
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(1));
    await userEvent.click(within(list).getAllByRole('button')[0] as HTMLElement);
    const page = within(canvasElement.ownerDocument.body);
    await waitFor(() => expect(page.getByRole('dialog')).toBeInTheDocument());
  },
};
