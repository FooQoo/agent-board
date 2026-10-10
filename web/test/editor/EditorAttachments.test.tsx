import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import type { RichMarkdownEditorHandle } from '../../src/components/editor/RichMarkdownEditor';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorShell } from '../../src/components/editor/EditorShell';
import { EditorBody } from '../../src/components/editor/EditorBody';
import { selectLocale } from '../../src/i18n';
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

function Host({ onFiles = vi.fn(), error }: { onFiles?: (files: File[]) => void; error?: string }) {
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
      attachmentError={error}
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

  it('closes only the nested zoom on Escape, restores thumbnail focus and keeps the draft', async () => {
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
    expect(document.activeElement).toBe(thumbnail);
    expect(descriptionBox().value).toBe('Before after');
  });

  it('shows validation failures while retaining editable text', () => {
    render(<Host error="PNG, JPEG, WebP, GIF" />);
    expect(screen.getByRole('alert').textContent).toContain('PNG, JPEG, WebP, GIF');
    expect(descriptionBox().value).toBe('Before after');
  });
});
