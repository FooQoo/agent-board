import type { Editor } from '@milkdown/kit/core';
import { nodeViewCtx } from '@milkdown/kit/core';
import { imageSchema } from '@milkdown/kit/preset/commonmark';
import { AddMarkStep } from '@milkdown/kit/prose/transform';
import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import { Plugin } from '@milkdown/kit/prose/state';
import type { EditorView, NodeView, NodeViewConstructor } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';
import { imageUrlOf, safeLinkUrl, type AttachmentResolver } from '../../lib/markdown';

/** What the image view reads when it draws: the latest resolver and the label of the placeholder. */
export interface RichImageOptions {
  resolve: () => AttachmentResolver | undefined;
  noImageLabel: () => string;
}

/**
 * A picture drawn in the body. The view is not editable; it shows the picture that the owned
 * reference resolves to, or the No image placeholder. The text is kept as the reference it was.
 */
class RichImageView implements NodeView {
  readonly dom: HTMLElement;
  private node: ProseNode;
  private readonly options: RichImageOptions;

  constructor(node: ProseNode, options: RichImageOptions) {
    this.node = node;
    this.options = options;
    this.dom = document.createElement('span');
    this.dom.className = 'rich-image';
    this.dom.contentEditable = 'false';
    this.render();
  }

  update(node: ProseNode): boolean {
    if (node.type.name !== 'image') return false;
    this.node = node;
    this.render();
    return true;
  }

  selectNode(): void {
    this.dom.classList.add('rich-image--selected');
  }

  deselectNode(): void {
    this.dom.classList.remove('rich-image--selected');
  }

  /** The view's own DOM changes (a picture loading, for one) are not edits of the body. */
  ignoreMutation(): boolean {
    return true;
  }

  private render(): void {
    const src = String(this.node.attrs.src ?? '');
    const alt = String(this.node.attrs.alt ?? '');
    const url = imageUrlOf(src, this.options.resolve());
    this.dom.replaceChildren();
    if (url === null) {
      this.dom.append(this.placeholder(alt));
      return;
    }
    const picture = document.createElement('img');
    picture.className = 'rich-image__picture';
    picture.src = url;
    picture.alt = alt;
    picture.referrerPolicy = 'no-referrer';
    picture.loading = 'lazy';
    picture.addEventListener('error', () => {
      picture.replaceWith(this.placeholder(alt));
    });
    this.dom.append(picture);
  }

  private placeholder(alt: string): HTMLElement {
    const box = document.createElement('span');
    box.className = 'rich-image__none';
    box.textContent = this.options.noImageLabel();
    if (alt !== '') {
      const caption = document.createElement('span');
      caption.className = 'rich-image__caption';
      caption.textContent = alt;
      box.append(caption);
    }
    return box;
  }
}

/**
 * Replaces the image node of the CommonMark preset, under the same name, so that a reference is
 * read and written as it was: a missing title stays missing, a title stays, and the alt text is
 * kept. The default image parser fails on a missing title, which deletes the image.
 */
export function richImageFeature(options: RichImageOptions) {
  return (editor: Editor): void => {
    editor.config((ctx) => {
      ctx.update(imageSchema.key, (previous) => (context) => {
        const base = previous(context);
        return {
          ...base,
          attrs: {
            src: { default: '', validate: 'string' },
            alt: { default: '', validate: 'string' },
            title: { default: '', validate: 'string' },
          },
          toDOM: (node) => [
            'img',
            { src: node.attrs.src, alt: node.attrs.alt, title: node.attrs.title || undefined },
          ],
          // The default rule takes the alt text as the title when there is none, so a pasted
          // reference would gain a title of its own. The title is read only as it was written.
          parseDOM: [
            {
              tag: 'img[src]',
              getAttrs: (dom) => {
                if (!(dom instanceof HTMLElement)) return false;
                return {
                  src: dom.getAttribute('src') || '',
                  alt: dom.getAttribute('alt') || '',
                  title: dom.getAttribute('title') || '',
                };
              },
            },
          ],
          parseMarkdown: {
            match: ({ type }) => type === 'image',
            runner: (state, node, type) => {
              state.addNode(type, {
                src: typeof node.url === 'string' ? node.url : '',
                alt: typeof node.alt === 'string' ? node.alt : '',
                title: typeof node.title === 'string' ? node.title : '',
              });
            },
          },
          toMarkdown: {
            match: (node) => node.type.name === 'image',
            runner: (state, node) => {
              state.addNode('image', undefined, undefined, {
                title: node.attrs.title,
                url: node.attrs.src,
                alt: node.attrs.alt,
              });
            },
          },
        };
      });
      const imageView: [string, NodeViewConstructor] = [
        'image',
        (node: ProseNode) => new RichImageView(node, options),
      ];
      ctx.update(nodeViewCtx, (views) => [...views, imageView]);
    });
  };
}

/**
 * A link whose target is not http(s) loses its link mark when a link is added in the editor, so
 * the editor never writes a link that the viewer would show as text.
 */
export const richLinkGuard = $prose(
  () =>
    new Plugin({
      appendTransaction(transactions, _previous, state) {
        if (!transactions.some((tr) => tr.steps.some((step) => step instanceof AddMarkStep))) {
          return null;
        }
        const linkType = state.schema.marks.link;
        if (!linkType) return null;
        const tr = state.tr;
        let changed = false;
        state.doc.descendants((node, position) => {
          if (!node.isInline) return true;
          for (const mark of node.marks) {
            if (mark.type !== linkType) continue;
            const href = String(mark.attrs.href ?? '');
            if (safeLinkUrl(href) !== null) continue;
            tr.removeMark(position, position + node.nodeSize, mark);
            changed = true;
          }
          return true;
        });
        return changed ? tr : null;
      },
    }),
);

/** The number of second-level headings, and their positions, in a document. */
export function secondLevelHeadings(view: EditorView): number[] {
  const positions: number[] = [];
  view.state.doc.descendants((node, position) => {
    if (node.type.name === 'heading' && node.attrs.level === 2) positions.push(position);
    return true;
  });
  return positions;
}
