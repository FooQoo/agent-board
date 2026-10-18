// biome-ignore lint/style/noExcessiveLinesPerFile: predates the 300-line limit; split it by responsibility rather than growing it.
import { markdown } from '@codemirror/lang-markdown';
import { LanguageDescription } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
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
import {
  mermaidThemeFromCss,
  renderMermaid,
  svgElementOf,
  watchPageTheme,
  type MermaidTheme,
  type RenderResult,
} from '../../lib/mermaid';
import { codeHighlight } from './codeHighlight';
import { outlineOf } from './outline';
import { richImageFeature, richLinkGuard, secondLevelHeadings } from './richMarkdownNodes';
import type { RichMarkdownEditorHandle, RichMarkdownEditorProps } from './RichMarkdownEditor';
import '../../styles/markdown.css';
import './richMarkdown.css';

function errorBlock(message: string): HTMLElement {
  const box = document.createElement('div');
  box.className = 'rich-mermaid rich-mermaid--error';
  box.setAttribute('role', 'alert');
  box.textContent = i18next.t('markdown.diagramError', { message });
  return box;
}

/** The drawing of a Mermaid block as an element: the diagram, or one line of the error. */
function previewElement(result: RenderResult): HTMLElement {
  if (!result.ok) return errorBlock(result.message);
  const svg = svgElementOf(result.svg);
  if (svg === null) return errorBlock('');
  const box = document.createElement('div');
  box.className = 'rich-mermaid';
  box.append(svg);
  return box;
}

interface PreviewEntry {
  content: string;
  apply: (value: HTMLElement) => void;
  element: HTMLElement | null;
  /** The element has been in the page; one that was and is gone belongs to a block that is gone. */
  attached: boolean;
}

/**
 * The Mermaid previews of one editor. A preview is drawn when its block is shown or changed, and
 * drawn again when the page theme changes. The draw is cached per source and theme, so only a
 * real change of colors draws again. A preview whose element left the page is no longer kept.
 */
export class MermaidPreviews {
  private readonly entries = new Set<PreviewEntry>();
  private theme: MermaidTheme = mermaidThemeFromCss();
  private readonly stopWatching: () => void;

  constructor() {
    this.stopWatching = watchPageTheme(() => this.redrawIfThemeChanged());
  }

  /** The `renderPreview` of the code block; the element arrives through `apply`, so this returns null. */
  render(language: string, content: string, apply: (value: HTMLElement) => void): null {
    if (language !== 'mermaid') return null;
    const entry: PreviewEntry = { content, apply, element: null, attached: false };
    this.entries.add(entry);
    this.draw(entry);
    return null;
  }

  dispose(): void {
    this.stopWatching();
    this.entries.clear();
  }

  private draw(entry: PreviewEntry): void {
    const theme = this.theme;
    void renderMermaid(entry.content, theme).then((result) => {
      // A drawing in older colors, or for a block that is gone, is not shown.
      if (!this.entries.has(entry) || theme !== this.theme) return;
      const element = previewElement(result);
      entry.element = element;
      entry.apply(element);
    });
  }

  private redrawIfThemeChanged(): void {
    const next = mermaidThemeFromCss();
    if (next.id === this.theme.id) return;
    this.theme = next;
    for (const entry of this.entries) {
      if (entry.element?.isConnected) entry.attached = true;
      if (entry.attached && entry.element !== null && !entry.element.isConnected) {
        this.entries.delete(entry);
      }
    }
    for (const entry of this.entries) this.draw(entry);
  }
}

const MARKDOWN_LANGUAGE = LanguageDescription.of({
  name: 'Markdown',
  alias: ['md', 'markdown'],
  support: markdown(),
});

/** The languages offered for a code block, and the ones it highlights. */
export const CODE_LANGUAGES = [MARKDOWN_LANGUAGE, ...languages];

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
  // The text the document is written as right after it was created. The writing of the original
  // may differ from it (notation is normalized), but a change is only a change from this text.
  const initialText = useRef<string | null>(null);
  // Actions asked for before the editor was ready (a heading to go to, text to insert).
  const pending = useRef<Array<() => void>>([]);
  const headings = useRef<{ dirty: boolean; offsets: number[] }>({ dirty: true, offsets: [] });
  const latest = useRef(props);
  latest.current = props;
  const [ready, setReady] = useState(false);

  // The header of a code or diagram block shows only for the block that was clicked.
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
  }, []);

  useEffect(() => {
    const element = host.current;
    if (element === null) return;
    const created = new CrepeBuilder({ root: element, defaultValue: original.current });
    const previews = new MermaidPreviews();
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
        languages: CODE_LANGUAGES,
        // Replaces CodeMirror's light-page default colors (see codeHighlight.ts).
        theme: codeHighlight,
        renderPreview: (language, content, apply) => previews.render(language, content, apply),
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
          // Changes the editor makes by itself after it is ready (a code block taking its
          // language, say) leave the text as it was, so they are not reported.
          const changed = markdown !== initialText.current;
          if (!changed && !edited.current) return;
          edited.current = changed;
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
        const start = initialText.current;
        if (current === null || !live.current || start === null) return original.current;
        return current.editor.action((ctx) => {
          const text = ctx.get(serializerCtx)(ctx.get(editorViewCtx).state.doc);
          return text === start ? original.current : text;
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
