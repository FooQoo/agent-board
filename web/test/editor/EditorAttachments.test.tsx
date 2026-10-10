import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef, useRef, useState } from 'react';
import type { RichMarkdownEditorHandle } from '../../src/components/editor/RichMarkdownEditor';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorShell } from '../../src/components/editor/EditorShell';
import { EditorBody } from '../../src/components/editor/EditorBody';
import { selectLocale } from '../../src/i18n';
import type { AttachmentNotice } from '../../src/components/editor/useAttachmentState';
import { editorSpy } from './fakeRichEditor';

vi.mock('../../src/components/editor/RichMarkdownEditor', () => import('./fakeRichEditor'));

const attachment = {
  id: '0123456789abcdef0123456789abcdef',
  name: 'screen [one].png',
  url: 'blob:http://localhost/preview',
  mediaType: 'image/png',
  source: 'local' as const,
  size: 123,
};

afterEach(cleanup);
beforeEach(() => {
  selectLocale('en');
  editorSpy.insert.mockClear();
  editorSpy.goTo.mockClear();
});

function Host({
  onFiles = vi.fn(),
  notice = null,
}: {
  onFiles?: (files: File[]) => void;
  notice?: AttachmentNotice | null;
}) {
  const [value, setValue] = useState('Before after');
  const editorRef = useRef<RichMarkdownEditorHandle>(null);
  return (
    <EditorBody
      title="Test"
      onTitleChange={() => {}}
      description={value}
      onDescriptionChange={setValue}
      editorRef={editorRef}
      disabled={false}
      attachments={[attachment]}
      onFiles={onFiles}
      onRemoveAttachment={() => {}}
      attachmentNotice={notice}
    />
  );
}

const descriptionBox = () =>
  screen.getByRole('textbox', { name: 'Description (Markdown)' }) as HTMLTextAreaElement;

describe('editor attachment side panel', () => {
  it('is always open on the right, with no toggle and no close button', () => {
    render(<Host />);
    const panel = screen.getByRole('region', { name: 'Image attachments' });
    expect(panel.classList.contains('editor-attachments')).toBe(true);
    expect(screen.queryByRole('button', { name: /Attachments · 1/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Close attachments panel' })).toBeNull();
    expect(screen.getByText('screen [one].png')).toBeTruthy();
    expect(descriptionBox().value).toBe('Before after');
  });

  it('inserts a stable reference at the cursor of the editor', async () => {
    render(<Host />);
    await userEvent.click(screen.getByRole('button', { name: 'Insert in description' }));
    expect(editorSpy.insert).toHaveBeenCalledExactlyOnceWith(
      '\n\n![screen \\[one\\].png](attachment:0123456789abcdef0123456789abcdef)\n\n',
    );
  });

  it('adds a clipboard image pasted into the description', () => {
    const onFiles = vi.fn();
    render(<Host onFiles={onFiles} />);
    const file = new File(['test'], 'paste.png', { type: 'image/png' });
    fireEvent.paste(descriptionBox(), { clipboardData: { files: [file] } });
    expect(onFiles).toHaveBeenCalledExactlyOnceWith([file]);
  });

  it('passes all selected files to validation instead of silently filtering invalid formats', () => {
    const onFiles = vi.fn();
    render(<Host onFiles={onFiles} />);
    const file = new File(['text'], 'invalid.txt', { type: 'text/plain' });
    const input = document.querySelector('input[type="file"]');
    if (input === null) throw new Error('missing file input');
    fireEvent.change(input, { target: { files: [file] } });
    expect(onFiles).toHaveBeenCalledExactlyOnceWith([file]);
  });

  it('closes only the enlarged picture on Escape, returns focus to its thumbnail and keeps the draft', async () => {
    function ParentDialog() {
      const [open, setOpen] = useState(true);
      return open ? (
        <EditorShell
          title="Card editor"
          badge="New"
          variant="create"
          dirty
          saving={false}
          error={null}
          onClose={() => setOpen(false)}
          actions={null}
        >
          <Host />
        </EditorShell>
      ) : null;
    }
    render(<ParentDialog />);
    const user = userEvent.setup();
    const thumbnail = screen.getByRole('button', { name: 'Preview screen [one].png' });
    await user.click(thumbnail);
    expect(screen.getByRole('dialog', { name: 'screen [one].png' })).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'screen [one].png' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Card editorNew' })).toBeTruthy();
    // The dialog is dirty, so a Escape that reached it would ask the question; it must not.
    expect(screen.queryByRole('dialog', { name: 'Discard changes?' })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(thumbnail));
    expect(descriptionBox().value).toBe('Before after');
  });

  it('shows a refused picture in the side panel, with its file name, and keeps the text', () => {
    render(<Host notice={{ kind: 'tooLarge', name: 'large.png' }} />);
    const panel = screen.getByRole('region', { name: 'Image attachments' });
    const alert = within(panel).getByRole('alert');
    expect(alert.textContent).toContain('Cannot add the image');
    expect(alert.textContent).toContain('large.png is larger than 10 MB. Choose a smaller image.');
    expect(document.querySelector('.editor__main [role="alert"]')).toBeNull();
    expect(descriptionBox().value).toBe('Before after');
  });

  it('shows the format and count notices in the design wording', () => {
    const { unmount } = render(<Host notice={{ kind: 'format', name: 'notes.txt' }} />);
    expect(screen.getByRole('alert').textContent).toContain(
      'notes.txt is not a supported format. Choose a PNG, JPEG, WebP or GIF image.',
    );
    unmount();
    render(<Host notice={{ kind: 'count' }} />);
    expect(screen.getByRole('alert').textContent).toContain('A card holds up to 20 images.');
  });
});

describe('the empty picture state', () => {
  it('is the shared button, so it takes the same look and focus rules as the other actions', () => {
    const { container } = render(
      <EditorBody
        title="Empty"
        onTitleChange={() => {}}
        description=""
        onDescriptionChange={() => {}}
        editorRef={createRef<RichMarkdownEditorHandle>()}
        disabled={false}
        attachments={[]}
        onFiles={vi.fn()}
        onRemoveAttachment={() => {}}
      />,
    );
    const empty = container.querySelector('.editor-attachments__empty');
    expect(empty?.tagName).toBe('BUTTON');
    expect(empty?.getAttribute('data-slot')).toBe('button');
  });
});
