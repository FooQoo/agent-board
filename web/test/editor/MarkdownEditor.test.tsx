import { EditorView } from '@codemirror/view';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MarkdownEditor,
  type MarkdownEditorHandle,
} from '../../src/components/editor/MarkdownEditor';

afterEach(cleanup);

function viewOf(): EditorView {
  const content = document.querySelector<HTMLElement>('.cm-content');
  const view = content ? EditorView.findFromDOM(content) : null;
  if (!view) throw new Error('no editor');
  return view;
}

function Controlled({
  initial,
  onValue,
  disabled,
  handle,
  onCursor,
}: {
  initial: string;
  onValue?: (value: string) => void;
  disabled?: boolean;
  handle?: React.Ref<MarkdownEditorHandle>;
  onCursor?: (position: number) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <MarkdownEditor
        ref={handle}
        value={value}
        onChange={(next) => {
          setValue(next);
          onValue?.(next);
        }}
        onCursorChange={onCursor}
        placeholder={'## Purpose\nWrite here.'}
        aria-label="Description (Markdown)"
        disabled={disabled}
      />
      <output data-testid="value">{value}</output>
    </>
  );
}

describe('MarkdownEditor', () => {
  it('shows the value in a labelled multi-line textbox', () => {
    render(<Controlled initial={'## Title\n\nbody'} />);
    const box = screen.getByRole('textbox', { name: 'Description (Markdown)' });
    expect(box.getAttribute('aria-multiline')).toBe('true');
    expect(box.textContent).toContain('body');
    expect(viewOf().state.doc.toString()).toBe('## Title\n\nbody');
  });

  it('reports every change of the text through onChange', () => {
    const onValue = vi.fn();
    render(<Controlled initial="abc" onValue={onValue} />);
    act(() => viewOf().dispatch({ changes: { from: 3, insert: 'd' } }));
    expect(onValue).toHaveBeenLastCalledWith('abcd');
    expect(screen.getByTestId('value').textContent).toBe('abcd');
  });

  it('follows a new value from outside without echoing it back', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <MarkdownEditor value="one" onChange={onChange} aria-label="Description" />,
    );
    rerender(<MarkdownEditor value="two" onChange={onChange} aria-label="Description" />);
    expect(viewOf().state.doc.toString()).toBe('two');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('shows the placeholder while empty', () => {
    render(<Controlled initial="" />);
    expect(document.querySelector('.cm-placeholder')?.textContent).toContain('Purpose');
    act(() => viewOf().dispatch({ changes: { from: 0, insert: 'x' } }));
    expect(document.querySelector('.cm-placeholder')).toBeNull();
  });

  it('cannot be edited while disabled', () => {
    render(<Controlled initial="locked" disabled />);
    const content = document.querySelector<HTMLElement>('.cm-content');
    expect(content?.getAttribute('contenteditable')).toBe('false');
    expect(content?.getAttribute('aria-disabled')).toBe('true');
    expect(viewOf().state.readOnly).toBe(true);
  });

  it('lets Tab move the focus on instead of trapping it', async () => {
    render(
      <>
        <Controlled initial="text" />
        <button type="button">Next</button>
      </>,
    );
    await userEvent.click(screen.getByRole('textbox', { name: 'Description (Markdown)' }));
    await userEvent.tab();
    expect(viewOf().state.doc.toString()).toBe('text');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Next' }));
  });

  it('undoes and redoes with the keyboard', async () => {
    render(<Controlled initial="" />);
    act(() => viewOf().dispatch({ changes: { from: 0, insert: 'abc' }, userEvent: 'input.type' }));
    viewOf().focus();
    await userEvent.keyboard('{Control>}z{/Control}');
    expect(viewOf().state.doc.toString()).toBe('');
    await userEvent.keyboard('{Control>}y{/Control}');
    expect(viewOf().state.doc.toString()).toBe('abc');
  });

  it('keeps 50,000 characters', () => {
    const long = 'あ'.repeat(50_000);
    const onValue = vi.fn();
    render(<Controlled initial={long} onValue={onValue} />);
    expect(viewOf().state.doc.length).toBe(50_000);
    act(() => viewOf().dispatch({ changes: { from: 50_000, insert: 'い' } }));
    expect(onValue.mock.lastCall?.[0]).toBe(`${long}い`);
  });

  it('gives a Markdown heading a highlight class', () => {
    render(<Controlled initial={'## Heading\n\nplain'} />);
    const heading = document.querySelector('.cm-md-heading');
    expect(heading?.textContent).toContain('Heading');
    expect(document.querySelector('.cm-line:last-child .cm-md-heading')).toBeNull();
  });

  it('moves the cursor through the handle and reports it', () => {
    const handle = createRef<MarkdownEditorHandle>();
    const onCursor = vi.fn();
    render(<Controlled initial={'## A\n\n## B'} handle={handle} onCursor={onCursor} />);
    act(() => handle.current?.goTo(6));
    expect(viewOf().state.selection.main.head).toBe(6);
    expect(onCursor).toHaveBeenLastCalledWith(6);
  });
});
