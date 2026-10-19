import { lazy, Suspense } from 'react';
import { MarkdownView } from '../markdown/MarkdownView';
import type { RichMarkdownEditorProps } from './richEditorTypes';

export type { RichMarkdownEditorHandle, RichMarkdownEditorProps } from './richEditorTypes';

const RichMarkdownEditorImpl = lazy(() => import('./RichMarkdownEditor.impl'));

/**
 * The shared rich Markdown editor. The editor code loads on first use; while it loads, the
 * read-only Markdown view of the same text is shown.
 */
export function RichMarkdownEditor({ value, resolveAttachment, ...rest }: RichMarkdownEditorProps) {
  return (
    <Suspense
      fallback={
        <MarkdownView source={value} variant="wide" resolveAttachment={resolveAttachment} />
      }
    >
      <RichMarkdownEditorImpl value={value} resolveAttachment={resolveAttachment} {...rest} />
    </Suspense>
  );
}
