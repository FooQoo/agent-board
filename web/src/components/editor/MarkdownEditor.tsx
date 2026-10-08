import { Annotation, Compartment, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import { baseExtensions, placeholderExtension } from './markdownExtensions';

export interface MarkdownEditorHandle {
  /** Puts the cursor at `position` and scrolls it into view. */
  goTo: (position: number) => void;
  focus: () => void;
  insert: (text: string) => void;
}

export interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  /** The cursor moved (or the text changed under it). */
  onCursorChange?: (position: number) => void;
  placeholder?: string;
  'aria-label': string;
  disabled?: boolean;
  ref?: Ref<MarkdownEditorHandle>;
}

/** Marks a change made from the `value` prop, which must not be reported back through onChange. */
const fromProps = Annotation.define<boolean>();

function dynamicExtensions(label: string, disabled: boolean, placeholder: string) {
  return [
    EditorView.contentAttributes.of({
      'aria-label': label,
      ...(disabled ? { 'aria-disabled': 'true' } : {}),
    }),
    EditorView.editable.of(!disabled),
    EditorState.readOnly.of(disabled),
    placeholderExtension(placeholder),
  ];
}

/**
 * A thin React wrapper around a CodeMirror 6 Markdown editor. The text lives in the parent
 * (`value` / `onChange`); the editor view is created once and follows later `value` changes.
 */
export function MarkdownEditor({
  value,
  onChange,
  onCursorChange,
  placeholder = '',
  'aria-label': label,
  disabled = false,
  ref,
}: MarkdownEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const dynamic = useRef(new Compartment());
  // What the view reads when it is created and when it reports back; it always holds the latest props.
  const latest = useRef({ value, label, disabled, placeholder, onChange, onCursorChange });
  latest.current = { value, label, disabled, placeholder, onChange, onCursorChange };

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: latest.current.value,
        extensions: [
          baseExtensions,
          dynamic.current.of(
            dynamicExtensions(
              latest.current.label,
              latest.current.disabled,
              latest.current.placeholder,
            ),
          ),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !update.transactions.some((tr) => tr.annotation(fromProps))) {
              latest.current.onChange(update.state.doc.toString());
            }
            if (update.docChanged || update.selectionSet) {
              latest.current.onCursorChange?.(update.state.selection.main.head);
            }
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (view === null || view.state.doc.toString() === value) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
      annotations: [fromProps.of(true)],
    });
  }, [value]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: dynamic.current.reconfigure(dynamicExtensions(label, disabled, placeholder)),
    });
  }, [label, disabled, placeholder]);

  useImperativeHandle(ref, () => ({
    goTo(position) {
      const view = viewRef.current;
      if (view === null) return;
      const head = Math.max(0, Math.min(position, view.state.doc.length));
      view.dispatch({
        selection: { anchor: head },
        effects: EditorView.scrollIntoView(head, { y: 'start', yMargin: 8 }),
      });
      view.focus();
    },
    focus() {
      viewRef.current?.focus();
    },
    insert(text) {
      const view = viewRef.current;
      if (view === null) return;
      const { from, to } = view.state.selection.main;
      view.dispatch({
        changes: { from, to, insert: text },
        selection: { anchor: from + text.length },
      });
      view.focus();
    },
  }));

  return <div className="md-editor" ref={hostRef} />;
}
