import { markdown } from '@codemirror/lang-markdown';
import { LanguageDescription } from '@codemirror/language';
import { CrepeBuilder } from '@milkdown/crepe/builder';
import { codeMirror } from '@milkdown/crepe/feature/code-mirror';
import { cursor } from '@milkdown/crepe/feature/cursor';
import { linkTooltip } from '@milkdown/crepe/feature/link-tooltip';
import { listItem } from '@milkdown/crepe/feature/list-item';
import { placeholder } from '@milkdown/crepe/feature/placeholder';
import { table } from '@milkdown/crepe/feature/table';
import { toolbar } from '@milkdown/crepe/feature/toolbar';
import type { Ctx } from '@milkdown/kit/ctx';
import {
  editorViewCtx,
  parserCtx,
  remarkStringifyOptionsCtx,
  serializerCtx,
  type Editor,
} from '@milkdown/kit/core';
import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import { Slice } from '@milkdown/kit/prose/model';
import { TextSelection } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import i18next from 'i18next';
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { useTranslation } from 'react-i18next';
import '../../i18n';
import type { AttachmentResolver } from '../../lib/markdown';
import { mermaidThemeFromCss, renderMermaid, svgElementOf } from '../../lib/mermaid';
import { outlineOf } from './outline';
import { richImageFeature, richLinkGuard, secondLevelHeadings } from './richMarkdownNodes';
import type { RichMarkdownEditorHandle, RichMarkdownEditorProps } from './RichMarkdownEditor';
import '../../styles/markdown.css';
import './richMarkdown.css';

const MARKDOWN_LANGUAGE = LanguageDescription.of({
  name: 'Markdown',
  alias: ['md', 'markdown'],
  support: markdown(),
});

function errorBlock(message: string): HTMLElement {
  const box = document.createElement('div');
  box.className = 'rich-mermaid rich-mermaid--error';
  box.setAttribute('role', 'alert');
  box.textContent = i18next.t('markdown.diagramError', { message });
  return box;
}

/**
 * The code-block preview for a Mermaid block: the same drawing as the viewer, or one line of the
 * error. The result is handed over later through `apply`; a wrong notation never blocks saving.
 */
export function previewFor(
  language: string,
  content: string,
  apply: (value: HTMLElement) => void,
): null {
  if (language !== 'mermaid') return null;
  void renderMermaid(content, mermaidThemeFromCss()).then((result) => {
    if (!result.ok) {
      apply(errorBlock(result.message));
      return;
    }
    const svg = svgElementOf(result.svg);
    if (svg === null) {
      apply(errorBlock(''));
      return;
    }
    const box = document.createElement('div');
    box.className = 'rich-mermaid';
    box.append(svg);
    apply(box);
  });
  return null;
}

interface SessionProps {
  text: string;
  label: string;
  placeholder: string;
  disabled: boolean;
  noImageLabel: string;
  resolveAttachment: AttachmentResolver | undefined;
  onReport: (markdown: string) => void;
  onCursorChange: ((position: number) => void) | undefined;
  handle: Ref<RichMarkdownEditorHandle> | undefined;
}

/**
 * One editor, created from `text` once. A new session (a new key) is made only when the value
 * changes from outside. The text is the original until a reader changes it.
 */
function EditorSession(props: SessionProps) {
  const host = useRef<HTMLDivElement>(null);
  const builder = useRef<CrepeBuilder | null>(null);
  const live = useRef(false);
  const original = useRef(props.text);
  const edited = useRef(false);
  // The document as it was created; a document equal to it still has the original text.
  const initialDoc = useRef<ProseNode | null>(null);
  const headings = useRef<{ dirty: boolean; offsets: number[] }>({ dirty: true, offsets: [] });
  const latest = useRef(props);
  latest.current = props;
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const element = host.current;
    if (element === null) return;
    const created = new CrepeBuilder({ root: element, defaultValue: original.current });
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

    created
      .addFeature(
        richImageFeature({
          resolve: () => latest.current.resolveAttachment,
          noImageLabel: () => latest.current.noImageLabel,
        }),
      )
      .addFeature((editor: Editor) => {
        editor.use(richLinkGuard);
        // The list marker is written as `-`, the form the viewer and the body use.
        editor.config((ctx) => {
          ctx.update(remarkStringifyOptionsCtx, (options) => ({
            ...options,
            bullet: '-' as const,
          }));
        });
      })
      .addFeature(codeMirror, {
        languages: [MARKDOWN_LANGUAGE],
        renderPreview: (language, content, apply) => previewFor(language, content, apply),
        previewOnlyByDefault: true,
      })
      .addFeature(listItem)
      .addFeature(cursor)
      .addFeature(placeholder, { text: latest.current.placeholder })
      .addFeature(linkTooltip)
      .addFeature(toolbar)
      .addFeature(table)
      .on((api) => {
        api.markdownUpdated((_ctx, markdown) => {
          if (!live.current) return;
          edited.current = true;
          headings.current.dirty = true;
          latest.current.onReport(markdown);
        });
        api.selectionUpdated((ctx, selection) => {
          const onCursor = latest.current.onCursorChange;
          if (!live.current || onCursor === undefined) return;
          const count = secondLevelHeadings(ctx.get(editorViewCtx)).filter(
            (position) => position < selection.head,
          ).length;
          if (count === 0) {
            onCursor(0);
            return;
          }
          onCursor(currentHeadingOffsets(count - 1));
        });
      });
    builder.current = created;

    let disposed = false;
    void created.create().then(() => {
      if (disposed) return;
      created.editor.action((ctx) => {
        initialDoc.current = ctx.get(editorViewCtx).state.doc;
      });
      live.current = true;
      setReady(true);
    });
    return () => {
      disposed = true;
      live.current = false;
      builder.current = null;
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
      const current = builder.current;
      if (current === null || !live.current) return;
      current.editor.action((ctx) => run(ctx.get(editorViewCtx), ctx));
    };
    return {
      goTo(index) {
        withView((view) => {
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
        withView((view) => view.focus());
      },
      insert(markdownText) {
        withView((view, ctx) => {
          const parsed: ProseNode = ctx.get(parserCtx)(markdownText);
          const single = parsed.childCount === 1 ? parsed.firstChild : null;
          const content =
            single !== null && single.type.name === 'paragraph' ? single.content : parsed.content;
          view.dispatch(view.state.tr.replaceSelection(new Slice(content, 0, 0)).scrollIntoView());
          view.focus();
        });
      },
      markdown() {
        const current = builder.current;
        const start = initialDoc.current;
        if (current === null || !live.current || start === null) return original.current;
        return current.editor.action((ctx) => {
          const doc = ctx.get(editorViewCtx).state.doc;
          if (doc.eq(start)) return original.current;
          return ctx.get(serializerCtx)(doc);
        });
      },
    };
  }, []);

  return <div ref={host} className="md md--wide rich-markdown" />;
}

/**
 * The editor for a description. The text is read when the session starts; a change is reported
 * only after the reader changes the text, and the value is replaced only when the parent gives a
 * different one.
 */
export default function RichMarkdownEditorImpl({
  value,
  onChange,
  onCursorChange,
  placeholder = '',
  'aria-label': label,
  disabled = false,
  resolveAttachment,
  ref,
}: RichMarkdownEditorProps) {
  const { t } = useTranslation();
  const reported = useRef(value);
  const [session, setSession] = useState({ id: 0, text: value });

  useEffect(() => {
    if (value === reported.current) return;
    reported.current = value;
    setSession((current) => ({ id: current.id + 1, text: value }));
  }, [value]);

  return (
    <EditorSession
      key={session.id}
      text={session.text}
      label={label}
      placeholder={placeholder}
      disabled={disabled}
      noImageLabel={t('markdown.noImage')}
      resolveAttachment={resolveAttachment}
      onReport={(markdownText) => {
        reported.current = markdownText;
        onChange(markdownText);
      }}
      onCursorChange={onCursorChange}
      handle={ref}
    />
  );
}
