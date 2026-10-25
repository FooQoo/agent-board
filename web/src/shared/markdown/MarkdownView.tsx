import { memo, useMemo } from 'react';
import { MarkdownBlocks, type MarkdownVariant } from './MarkdownBlocks';
import type { AttachmentResolver } from './model';

export type { MarkdownVariant };

/**
 * GitHub-flavored Markdown from one text, as React elements. It is `MarkdownBlocks` with the text as
 * a single block, so it looks the same and is never virtualized. Raw HTML is shown as text, a single
 * newline is a line break, and URLs are checked by the renderer, not by the library.
 */
export const MarkdownView = memo(function MarkdownView({
  source,
  variant = 'compact',
  resolveAttachment,
}: {
  source: string;
  variant?: MarkdownVariant;
  resolveAttachment?: AttachmentResolver;
}) {
  const blocks = useMemo(() => [{ id: 'source', kind: 'markdown' as const, source }], [source]);
  return <MarkdownBlocks blocks={blocks} variant={variant} resolveAttachment={resolveAttachment} />;
});
