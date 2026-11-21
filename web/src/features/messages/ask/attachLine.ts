/**
 * The task ids a request refers to live on its last line as `#552 #651`. The request text is the
 * only source of truth: there is no separate selection state, so these functions read and rewrite
 * that line.
 */

/** A line made only of `#<digits>` tokens separated by spaces. */
const ATTACHMENT_LINE = /^[ \t]*#\d+(?:[ \t]+#\d+)*[ \t]*$/;

/** Splits a request into the text before its attachment line and the ids on that line. */
export function splitAttachmentLine(text: string): { body: string; ids: number[] } {
  const trimmed = text.trimEnd();
  const start = trimmed.lastIndexOf('\n') + 1;
  const last = trimmed.slice(start);
  if (!ATTACHMENT_LINE.test(last)) return { body: text, ids: [] };
  const ids = [...new Set([...last.matchAll(/#(\d+)/g)].map((match) => Number(match[1])))];
  return { body: trimmed.slice(0, start), ids };
}

/** The task ids on the last line of a request, in order; empty when it has no attachment line. */
export function attachedTaskIds(text: string): number[] {
  return splitAttachmentLine(text).ids;
}

/**
 * Puts `ids` on the last line, replacing an existing attachment line rather than adding a second
 * one, and drops trailing whitespace. No ids removes the line.
 */
export function withAttachedTasks(text: string, ids: readonly number[]): string {
  const { body } = splitAttachmentLine(text);
  const head = body.trimEnd();
  if (ids.length === 0) return head;
  const line = ids.map((id) => `#${id}`).join(' ');
  return head === '' ? line : `${head}\n${line}`;
}
