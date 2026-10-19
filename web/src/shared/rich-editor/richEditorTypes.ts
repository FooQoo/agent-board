import type { Ref } from 'react';
import type { AttachmentResolver } from '../markdown/model';

/** What the parent can do with the editor: go to a second-level heading, focus, insert, read. */
export interface RichMarkdownEditorHandle {
  /** Puts the cursor at the start of the nth second-level heading (counted from 0) and scrolls to it. */
  goTo: (headingIndex: number) => void;
  focus: () => void;
  /** Inserts Markdown at the cursor, as a picture reference when it is one. */
  insert: (markdown: string) => void;
  /** The text now: the original text until the reader changes it. */
  markdown: () => string;
}

export interface RichMarkdownEditorProps {
  value: string;
  /** Called only when the reader changes the text. */
  onChange: (value: string) => void;
  /** The cursor moved; the position is an offset in the Markdown text of the heading above it. */
  onCursorChange?: (position: number) => void;
  placeholder?: string;
  'aria-label': string;
  disabled?: boolean;
  /** Turns an owned attachment id into an image URL, or null when it is not one of the card's. */
  resolveAttachment?: AttachmentResolver;
  ref?: Ref<RichMarkdownEditorHandle>;
}
