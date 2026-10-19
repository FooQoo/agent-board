import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';
import { SAMPLE_IMAGE_URL } from '../../../../.storybook/support/fixtures';
import type { EditorAttachment } from './attachmentTypes';
import { AttachmentPanel } from './AttachmentPanel';

const meta = {
  title: 'Editor/AttachmentPanel',
  component: AttachmentPanel,
  args: { attachments: [], onFiles: () => {}, onRemove: () => {} },
} satisfies Meta<typeof AttachmentPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

function AttachmentHost() {
  const [attachments, setAttachments] = useState<EditorAttachment[]>([
    {
      id: 'stored-1',
      name: 'planning.png',
      mediaType: 'image/png',
      size: 4096,
      url: SAMPLE_IMAGE_URL,
      source: 'stored',
    },
  ]);
  return (
    <AttachmentPanel
      attachments={attachments}
      onFiles={(files) =>
        setAttachments((current) => [
          ...current,
          ...files.map((file, index) => ({
            id: `local-${index + 1}`,
            name: file.name,
            mediaType: file.type,
            size: file.size,
            url: URL.createObjectURL(file),
            source: 'local' as const,
            file,
          })),
        ])
      }
      onRemove={(id) => setAttachments((current) => current.filter((item) => item.id !== id))}
      onInsert={(item) => {
        document.body.dataset.inserted = item.id;
      }}
    />
  );
}

export const StoredAttachment: Story = {
  render: () => <AttachmentHost />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('region', { name: 'Image attachments' })).toBeInTheDocument();
    await expect(canvas.getByText('planning.png')).toBeInTheDocument();
    await userEvent.click(canvas.getByRole('button', { name: /Remove planning.png/i }));
    await expect(canvas.queryByText('planning.png')).toBeNull();
  },
};

export const RefusedImage: Story = {
  args: {
    notice: { kind: 'format', name: 'notes.txt' },
    attachments: [],
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('alert')).toBeInTheDocument();
    await expect(within(canvasElement).getByText(/notes.txt/)).toBeInTheDocument();
  },
};

export const SavingDisabled: Story = {
  args: { disabled: true },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('button', { name: 'Add image attachment' }),
    ).toBeDisabled();
  },
};
