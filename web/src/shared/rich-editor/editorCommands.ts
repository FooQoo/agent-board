import type { Ctx } from '@milkdown/kit/ctx';
import { parserCtx } from '@milkdown/kit/core';
import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import { Slice } from '@milkdown/kit/prose/model';
import { TextSelection } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import type { RichMarkdownEditorHandle } from './richEditorTypes';
import { secondLevelHeadings } from './richMarkdownNodes';

/** What the commands need of the session: a way to act on the view, and the text now. */
export interface CommandHost {
  /** Runs `run` on the view now, or after the editor is ready when it is not yet. */
  withView: (run: (view: EditorView, ctx: Ctx) => void) => void;
  markdown: () => string;
}

/** The handle the parent holds: go to a heading, focus, insert, and read the text. */
export function createEditorCommands(host: CommandHost): RichMarkdownEditorHandle {
  return {
    goTo(index) {
      host.withView((view) => {
        const position = secondLevelHeadings(view)[index];
        if (position === undefined) return;
        view.dispatch(
          view.state.tr
            .setSelection(TextSelection.create(view.state.doc, position + 1))
            .scrollIntoView(),
        );
        view.focus();
      });
    },
    focus() {
      host.withView((view) => view.focus());
    },
    insert(markdownText) {
      host.withView((view, ctx) => {
        const parsed: ProseNode = ctx.get(parserCtx)(markdownText);
        const single = parsed.childCount === 1 ? parsed.firstChild : null;
        const content =
          single !== null && single.type.name === 'paragraph' ? single.content : parsed.content;
        view.dispatch(view.state.tr.replaceSelection(new Slice(content, 0, 0)).scrollIntoView());
        view.focus();
      });
    },
    markdown: host.markdown,
  };
}
