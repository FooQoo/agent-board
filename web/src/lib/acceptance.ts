import type { AcceptanceItem } from '../types';

/** How many completion conditions of a card or epic are done, and whether all of them are. */
export interface AcceptanceProgress {
  done: number;
  total: number;
  /** True when there is at least one condition and every one is done. */
  complete: boolean;
}

export function progressOf(items: readonly { done: boolean }[]): AcceptanceProgress {
  const done = items.filter((item) => item.done).length;
  return { done, total: items.length, complete: items.length > 0 && done === items.length };
}

/**
 * The ID of a new condition: the number after the largest `AC-n` among `seenIds`. Pass every ID the
 * editor has shown, removed ones included, so that a removed number is not reused.
 */
export function nextId(seenIds: readonly string[]): string {
  let largest = 0;
  for (const id of seenIds) {
    const match = /^AC-(\d+)$/.exec(id);
    if (match) largest = Math.max(largest, Number(match[1]));
  }
  return `AC-${largest + 1}`;
}

/** The index of the first condition whose text is blank or longer than 2,000 characters, or null. */
export function acceptanceProblem(items: readonly AcceptanceItem[]): number | null {
  const index = items.findIndex((item) => {
    const length = [...item.text.trim()].length;
    return length === 0 || length > 2000;
  });
  return index === -1 ? null : index;
}

/**
 * The whole text of a new file: the frontmatter with the conditions, then the body. Strings are written as
 * JSON, which is also valid YAML. A file that exists is written by the server instead, which keeps its keys.
 */
export function composeNewText(body: string, items: readonly AcceptanceItem[]): string {
  const list =
    items.length === 0
      ? ' []'
      : items
          .map(
            (item) =>
              `\n  - id: ${JSON.stringify(item.id)}\n    text: ${JSON.stringify(item.text)}\n    done: ${item.done}`,
          )
          .join('');
  return `---\nacceptance:${list}\n---\n\n${body}`;
}
