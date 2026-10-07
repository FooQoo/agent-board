import { EditorView } from '@codemirror/view';
import { act } from '@testing-library/react';

/** The CodeMirror view inside `root` (typing into a contenteditable is unreliable in jsdom). */
export function viewIn(root: ParentNode = document): EditorView {
  const content = root.querySelector<HTMLElement>('.cm-content');
  const view = content ? EditorView.findFromDOM(content) : null;
  if (!view) throw new Error('no editor in the page');
  return view;
}

/** Replaces the whole description the way a person's input would. */
export function setDescription(text: string, root: ParentNode = document): void {
  const view = viewIn(root);
  act(() => {
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: text },
      userEvent: 'input.type',
    });
  });
}

export function descriptionOf(root: ParentNode = document): string {
  return viewIn(root).state.doc.toString();
}
