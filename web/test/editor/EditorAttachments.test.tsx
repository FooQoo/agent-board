import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorShell } from '../../src/components/editor/EditorShell';
import { EditorBody } from '../../src/components/editor/EditorBody';
import { selectLocale } from '../../src/i18n';
import { descriptionOf, viewIn } from './helpers';

const attachment = {
  id: '0123456789abcdef0123456789abcdef',
  name: 'screen [one].png',
  url: 'blob:http://localhost/preview',
  mediaType: 'image/png',
  source: 'local' as const,
  size: 123,
};
afterEach(cleanup);
beforeEach(() => selectLocale('en'));
function Host({ onFiles = vi.fn(), error }: { onFiles?: (files: File[]) => void; error?: string }) {
  const [value, setValue] = useState('Before after');
  return (
    <EditorBody
      title="Test"
      onTitleChange={() => {}}
      description={value}
      onDescriptionChange={setValue}
      disabled={false}
      attachments={[attachment]}
      onFiles={onFiles}
      onRemoveAttachment={() => {}}
      attachmentError={error}
    />
  );
}

describe('editor attachment side panel', () => {
  it('starts closed and opens and closes from the toolbar without changing editor text', async () => {
    render(<Host />);
    const user = userEvent.setup();
    const toggle = screen.getByRole('button', { name: 'Attachments · 1' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(
      screen.queryByRole('region', { name: 'Choose files, drag and drop, or paste an image' }),
    ).toBeNull();
    await user.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelector('.editor__main + .editor-attachments')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Close attachments panel' }));
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(descriptionOf()).toBe('Before after');
  });

  it('inserts a stable reference at the preserved cursor from preview and returns focus to edit', async () => {
    render(<Host />);
    const user = userEvent.setup();
    act(() => viewIn().dispatch({ selection: { anchor: 7 } }));
    await user.click(screen.getByRole('tab', { name: 'Preview' }));
    await user.click(screen.getByRole('button', { name: 'Attachments · 1' }));
    await user.click(screen.getByRole('button', { name: 'Insert in description' }));
    expect(descriptionOf()).toBe(
      'Before \n\n![screen \\[one\\].png](attachment:0123456789abcdef0123456789abcdef)\n\nafter',
    );
    expect(screen.getByRole('tab', { name: 'Edit' }).getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(document.querySelector('.cm-content'));
    expect(descriptionOf()).not.toContain('blob:');
  });

  it('adds a clipboard image from the description and opens the side panel once', () => {
    const onFiles = vi.fn();
    render(<Host onFiles={onFiles} />);
    const file = new File(['test'], 'paste.png', { type: 'image/png' });
    fireEvent.paste(screen.getByRole('textbox', { name: 'Description (Markdown)' }), {
      clipboardData: { files: [file] },
    });
    expect(onFiles).toHaveBeenCalledExactlyOnceWith([file]);
    expect(
      screen.getByRole('button', { name: 'Attachments · 1' }).getAttribute('aria-expanded'),
    ).toBe('true');
  });

  it('passes all selected files to validation instead of silently filtering invalid formats', async () => {
    const onFiles = vi.fn();
    render(<Host onFiles={onFiles} />);
    await userEvent.click(screen.getByRole('button', { name: 'Attachments · 1' }));
    const file = new File(['text'], 'invalid.txt', { type: 'text/plain' });
    const input = document.querySelector('input[type="file"]');
    if (input === null) throw new Error('missing file input');
    fireEvent.change(input, { target: { files: [file] } });
    expect(onFiles).toHaveBeenCalledExactlyOnceWith([file]);
  });

  it('closes only the nested zoom on Escape, restores thumbnail focus and preserves the editor draft', async () => {
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
    act(() => viewIn().dispatch({ selection: { anchor: 7 } }));
    await user.click(screen.getByRole('button', { name: 'Attachments · 1' }));
    const thumbnail = screen.getByRole('button', { name: 'Preview screen [one].png' });
    await user.click(thumbnail);
    expect(screen.getByRole('dialog', { name: 'screen [one].png' })).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'screen [one].png' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Card editorNew' })).toBeTruthy();
    expect(document.activeElement).toBe(thumbnail);
    expect(descriptionOf()).toBe('Before after');
    expect(viewIn().state.selection.main.head).toBe(7);
  });

  it('shows validation failures while retaining editable text', () => {
    render(<Host error="PNG, JPEG, WebP, GIF" />);
    expect(screen.getByRole('alert').textContent).toContain('PNG, JPEG, WebP, GIF');
    expect(descriptionOf()).toBe('Before after');
  });
});
