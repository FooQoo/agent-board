import { useImperativeHandle, useRef, useState, type Ref } from 'react';
import { vi } from 'vitest';
import type { RichMarkdownEditorHandle } from '../../src/shared/rich-editor/RichMarkdownEditor';

/**
 * A stand-in for the rich editor in the dialog tests: a plain textarea with the handle the dialogs
 * use. The real editor is tested in `RichMarkdownEditor.test.tsx`; here the dialogs' own behavior is
 * what counts. `editorSpy` records the calls the dialogs make to the handle.
 */
export const editorSpy = {
  goTo: vi.fn<(headingIndex: number) => void>(),
  insert: vi.fn<(markdown: string) => void>(),
};

interface FakeProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  'aria-label': string;
  placeholder?: string;
  ref?: Ref<RichMarkdownEditorHandle>;
}

export function RichMarkdownEditor({
  value,
  onChange,
  disabled,
  'aria-label': label,
  ref,
}: FakeProps) {
  const [text, setText] = useState(value);
  const current = useRef(value);
  useImperativeHandle(
    ref,
    () => ({
      goTo: (headingIndex: number) => editorSpy.goTo(headingIndex),
      focus: () => undefined,
      insert: (markdown: string) => {
        editorSpy.insert(markdown);
        current.current = `${current.current}${markdown}`;
        setText(current.current);
        onChange(current.current);
      },
      markdown: () => current.current,
    }),
    [onChange],
  );
  return (
    <textarea
      aria-label={label}
      value={text}
      disabled={disabled}
      onChange={(event) => {
        current.current = event.target.value;
        setText(event.target.value);
        onChange(event.target.value);
      }}
    />
  );
}
