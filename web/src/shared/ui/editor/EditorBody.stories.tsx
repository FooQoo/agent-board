import type { Meta, StoryObj } from '@storybook/react-vite';
import { useRef, useState } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import type { RichMarkdownEditorHandle } from '../../rich-editor/RichMarkdownEditor';
import { EditorBody } from './EditorBody';
import { EditorShell } from './EditorShell';

function EditorHost() {
  const [title, setTitle] = useState('Prepare release notes');
  const [description, setDescription] = useState('## Summary\n\nA real editor inside the shared shell.\n');
  const editorRef = useRef<RichMarkdownEditorHandle>(null);
  const [closed, setClosed] = useState(false);
  if (closed) return <button type="button" onClick={() => setClosed(false)}>Open editor</button>;
  return (
    <EditorShell
      taskId={42}
      title="Edit task"
      badge="Draft"
      variant="edit"
      dirty={title !== 'Prepare release notes'}
      saving={false}
      error={null}
      onClose={() => setClosed(true)}
      status="Unsaved changes"
      actions={<button type="button" onClick={() => setClosed(true)}>Save</button>}
    >
      <EditorBody
        title={title}
        onTitleChange={setTitle}
        description={description}
        onDescriptionChange={setDescription}
        editorRef={editorRef}
        disabled={false}
        dock={
          <div role="group" aria-label="Editor tools">
            <button type="button">Insert link</button>
          </div>
        }
      />
    </EditorShell>
  );
}

const meta = {
  title: 'Editor/EditorBody',
  component: EditorHost,
} satisfies Meta<typeof EditorHost>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SharedEditSurface: Story = {
  play: async ({ canvasElement }) => {
    const root = canvasElement.ownerDocument.body;
    const canvas = within(root);
    await expect(canvas.getByRole('dialog')).toBeInTheDocument();
    const title = canvas.getByRole('textbox', { name: 'Title' });
    await userEvent.clear(title);
    await userEvent.type(title, 'Release notes');
    await expect(title).toHaveValue('Release notes');
    await waitFor(() => expect(root.querySelector('.ProseMirror h2')).toHaveTextContent('Summary'));
    await expect(canvas.getByRole('group', { name: 'Editor tools' })).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'Insert link' })).toBeInTheDocument();
  },
};

export const SavingErrorAndRetry: Story = {
  render: () => (
    <EditorShell
      title="Edit task"
      badge="Draft"
      variant="edit"
      dirty
      saving={false}
      error="Could not save. Try again."
      onRetry={() => {}}
      onClose={() => {}}
      actions={<button type="button">Save</button>}
    >
      <div className="editor__body">The draft remains available for another attempt.</div>
    </EditorShell>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement.ownerDocument.body);
    await expect(canvas.getByRole('alert')).toHaveTextContent('Could not save. Try again.');
    await expect(canvas.getByRole('button', { name: 'Retry' })).toBeEnabled();
  },
};
