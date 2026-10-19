import { type ComponentProps, Suspense } from 'react';
import { preloadable } from '../lib/lazy/preloadable';
import type { MarkdownSections as Sections } from './MarkdownSections';

/** The Markdown renderer (parser, GitHub extensions and Mermaid loader) loads after the board is shown. */
const sections = preloadable(() =>
  import('./MarkdownSections').then((module) => module.MarkdownSections),
);

/** Fetches the renderer; a failed fetch is tried again when a description is first shown. */
export function preloadMarkdownSections(): Promise<unknown> {
  return sections.preload();
}

/** `MarkdownSections`, showing the plain text until the renderer has loaded. */
export function LazyMarkdownSections(props: ComponentProps<typeof Sections>) {
  return (
    <Suspense fallback={<p className="md-pending">{props.source}</p>}>
      <sections.Component {...props} />
    </Suspense>
  );
}
