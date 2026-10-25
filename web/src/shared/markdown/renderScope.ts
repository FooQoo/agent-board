import { createContext } from 'react';
import type { AttachmentResolver } from './model';

/**
 * How a Markdown block is allowed to draw its diagrams. A block of kind `mermaid` waits until it is
 * near the viewport (`deferMermaid`) and until the whole block has arrived (`complete`). `scrollParent`
 * is the element whose edge the nearness is measured from; without one the page viewport is used.
 */
export interface RenderScope {
  scrollParent: HTMLElement | null;
  deferMermaid: boolean;
  complete: boolean;
}

/** A diagram drawn alone, as a fence inside text, draws at once: that is the default. */
export const RenderScopeContext = createContext<RenderScope>({
  scrollParent: null,
  deferMermaid: false,
  complete: true,
});

/** The size of a picture by the `src` written in the text, read from its file by the server. */
export type ImageSizes = ReadonlyMap<string, { width: number; height: number }>;
export const ImageSizesContext = createContext<ImageSizes | undefined>(undefined);

/** Turns an attachment id of the card into the URL to show. */
export const ResolverContext = createContext<AttachmentResolver | undefined>(undefined);

/** A second-level heading is drawn as a chapter title one level down, under a title that is already an H2. */
export const ChapterHeadingsContext = createContext(false);
