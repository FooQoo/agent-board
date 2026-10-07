import { defaultKeymap, history } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { describe, expect, it } from 'vitest';

describe('CodeMirror 6 packages', () => {
  it('create a Markdown editor in jsdom', () => {
    const highlight = HighlightStyle.define([{ tag: tags.heading, fontWeight: '600' }]);
    const parent = document.createElement('div');
    document.body.append(parent);
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: '## Heading\n\n- item',
        extensions: [
          history(),
          keymap.of(defaultKeymap),
          markdown(),
          syntaxHighlighting(highlight),
        ],
      }),
    });
    expect(view.state.doc.toString()).toBe('## Heading\n\n- item');
    expect(parent.querySelector('.cm-content')).toBeTruthy();
    view.destroy();
    parent.remove();
  });
});
