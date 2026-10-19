import { CrepeBuilder } from '@milkdown/crepe/builder';
import { codeMirror } from '@milkdown/crepe/feature/code-mirror';
import { cursor } from '@milkdown/crepe/feature/cursor';
import { linkTooltip } from '@milkdown/crepe/feature/link-tooltip';
import { listItem } from '@milkdown/crepe/feature/list-item';
import { placeholder } from '@milkdown/crepe/feature/placeholder';
import { table } from '@milkdown/crepe/feature/table';
import { toolbar } from '@milkdown/crepe/feature/toolbar';
import type { Ctx } from '@milkdown/kit/ctx';
import { remarkStringifyOptionsCtx, type Editor } from '@milkdown/kit/core';
import { codeHighlight } from './codeHighlight';
import { CODE_LANGUAGES } from './codeLanguages';
import type { MermaidPreviews } from './MermaidPreviews';
import { richImageFeature, richLinkGuard, type RichImageOptions } from './richMarkdownNodes';

export interface RichEditorSetup {
  root: HTMLElement;
  /** The Markdown the document starts as. */
  defaultValue: string;
  placeholder: string;
  image: RichImageOptions;
  previews: MermaidPreviews;
  /** The document changed; `markdown` is how it is written now. */
  onMarkdown: (markdown: string) => void;
  /** The selection moved; `head` is the position of its head in the document. */
  onSelection: (ctx: Ctx, head: number) => void;
}

/**
 * The editor of one session, with the features the product uses and none of Crepe's theme, block,
 * LaTeX, top bar, or AI features. It is built but not created; the caller creates it.
 */
export function createRichEditor(setup: RichEditorSetup): CrepeBuilder {
  return new CrepeBuilder({ root: setup.root, defaultValue: setup.defaultValue })
    .addFeature(richImageFeature(setup.image))
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
      renderPreview: (language, content, apply) => setup.previews.render(language, content, apply),
      previewOnlyByDefault: true,
    })
    .addFeature(listItem)
    .addFeature(cursor)
    .addFeature(placeholder, { text: setup.placeholder })
    .addFeature(linkTooltip)
    .addFeature(toolbar)
    .addFeature(table)
    .on((api) => {
      api.markdownUpdated((_ctx, markdown) => setup.onMarkdown(markdown));
      api.selectionUpdated((ctx, selection) => setup.onSelection(ctx, selection.head));
    });
}
