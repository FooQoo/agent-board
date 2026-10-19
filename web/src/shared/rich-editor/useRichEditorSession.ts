import type { CrepeBuilder } from '@milkdown/crepe/builder';
import type { Ctx } from '@milkdown/kit/ctx';
import { editorViewCtx, serializerCtx } from '@milkdown/kit/core';
import type { EditorView } from '@milkdown/kit/prose/view';
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import type { AttachmentResolver } from '../markdown/model';
import { createRichEditor } from './createEditor';
import { createEditorCommands } from './editorCommands';
import { MermaidPreviews } from './MermaidPreviews';
import { outlineOf } from './outline';
import type { RichMarkdownEditorHandle } from './richEditorTypes';
import { secondLevelHeadings } from './richMarkdownNodes';

export interface SessionProps {
  text: string;
  label: string;
  placeholder: string;
  disabled: boolean;
  noImageLabel: string;
  /** The sentence for a diagram that cannot be drawn, in the language of the page. */
  diagramError: (message: string) => string;
  resolveAttachment: AttachmentResolver | undefined;
  onReport: (markdown: string) => void;
  onCursorChange: ((position: number) => void) | undefined;
  handle: Ref<RichMarkdownEditorHandle> | undefined;
}

/** The header of a code or diagram block shows only for the block that was clicked. */
function useActiveCodeHeader(host: React.RefObject<HTMLDivElement | null>): void {
  useEffect(() => {
    const element = host.current;
    if (element === null) return;
    const activate = (event: PointerEvent) => {
      const target =
        event.target instanceof Element ? event.target.closest('.milkdown-code-block') : null;
      for (const block of element.querySelectorAll('.milkdown-code-block[data-active]')) {
        if (block !== target) block.removeAttribute('data-active');
      }
      target?.setAttribute('data-active', 'true');
    };
    element.addEventListener('pointerdown', activate);
    return () => element.removeEventListener('pointerdown', activate);
  }, [host]);
}

/**
 * One editor, created from `props.text` once, and what the session keeps: the original text, whether
 * the reader changed it, actions asked for before the editor was ready, and the heading offsets. The
 * text is the original until a reader changes it. Returns the element the editor draws into.
 */
export function useRichEditorSession(props: SessionProps): React.RefObject<HTMLDivElement | null> {
  const host = useRef<HTMLDivElement>(null);
  const builder = useRef<CrepeBuilder | null>(null);
  const live = useRef(false);
  const original = useRef(props.text);
  const edited = useRef(false);
  // The text the document is written as right after it was created. The writing of the original
  // may differ from it (notation is normalized), but a change is only a change from this text.
  const initialText = useRef<string | null>(null);
  // Actions asked for before the editor was ready (a heading to go to, text to insert).
  const pending = useRef<Array<() => void>>([]);
  const headings = useRef<{ dirty: boolean; offsets: number[] }>({ dirty: true, offsets: [] });
  const latest = useRef(props);
  latest.current = props;
  const [ready, setReady] = useState(false);

  useActiveCodeHeader(host);

  useEffect(() => {
    const element = host.current;
    if (element === null) return;
    const previews = new MermaidPreviews((message) => latest.current.diagramError(message));
    // The offset of the nth second-level heading in the text this session reports.
    const currentHeadingOffsets = (index: number): number => {
      if (headings.current.dirty) {
        const text = edited.current
          ? (builder.current?.getMarkdown() ?? original.current)
          : original.current;
        headings.current = { dirty: false, offsets: outlineOf(text).map((item) => item.from) };
      }
      return headings.current.offsets[index] ?? 0;
    };
    const created = createRichEditor({
      root: element,
      defaultValue: original.current,
      placeholder: latest.current.placeholder,
      image: {
        resolve: () => latest.current.resolveAttachment,
        noImageLabel: () => latest.current.noImageLabel,
      },
      previews,
      onMarkdown: (markdown) => {
        if (!live.current) return;
        // Changes the editor makes by itself after it is ready (a code block taking its
        // language, say) leave the text as it was, so they are not reported.
        const changed = markdown !== initialText.current;
        if (!changed && !edited.current) return;
        edited.current = changed;
        headings.current.dirty = true;
        latest.current.onReport(markdown);
      },
      onSelection: (ctx: Ctx, head: number) => {
        const onCursor = latest.current.onCursorChange;
        if (!live.current || onCursor === undefined) return;
        const count = secondLevelHeadings(ctx.get(editorViewCtx)).filter(
          (position) => position < head,
        ).length;
        onCursor(count === 0 ? 0 : currentHeadingOffsets(count - 1));
      },
    });
    builder.current = created;

    let disposed = false;
    void created.create().then(() => {
      if (disposed) return;
      created.editor.action((ctx) => {
        initialText.current = ctx.get(serializerCtx)(ctx.get(editorViewCtx).state.doc);
      });
      live.current = true;
      for (const run of pending.current.splice(0)) run();
      setReady(true);
    });
    return () => {
      disposed = true;
      live.current = false;
      builder.current = null;
      previews.dispose();
      created.destroy().catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    builder.current?.setReadonly(props.disabled);
    host.current?.querySelector('.ProseMirror')?.setAttribute('aria-label', props.label);
  }, [ready, props.disabled, props.label]);

  useImperativeHandle(props.handle, () => {
    const withView = (run: (view: EditorView, ctx: Ctx) => void) => {
      const perform = () => {
        const current = builder.current;
        if (current === null) return;
        current.editor.action((ctx) => run(ctx.get(editorViewCtx), ctx));
      };
      if (live.current) perform();
      else pending.current.push(perform);
    };
    const markdown = () => {
      const current = builder.current;
      const start = initialText.current;
      if (current === null || !live.current || start === null) return original.current;
      return current.editor.action((ctx) => {
        const text = ctx.get(serializerCtx)(ctx.get(editorViewCtx).state.doc);
        return text === start ? original.current : text;
      });
    };
    return createEditorCommands({ withView, markdown });
  }, []);

  return host;
}
