/** The longest description the CLI, the API and the screen accept, in Unicode scalar values. */
export const DESCRIPTION_LIMIT = 50_000;
export const TITLE_LIMIT = 100;

/** The line endings are stored as LF, so the screen counts and sends them that way. */
export function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

/** Counts Unicode scalar values (an emoji is one, not two UTF-16 units). */
export function countChars(text: string): number {
  let count = 0;
  for (const _ of text) count += 1;
  return count;
}

export type TitleProblem = 'required' | 'tooLong' | 'multiline';

export function titleProblem(title: string): TitleProblem | null {
  const trimmed = title.trim();
  if (trimmed === '') return 'required';
  if (/[\r\n]/.test(trimmed)) return 'multiline';
  if (countChars(trimmed) > TITLE_LIMIT) return 'tooLong';
  return null;
}
