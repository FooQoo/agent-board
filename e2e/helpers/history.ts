import { expect } from '@playwright/test';

/** Check the shared history shape and the context retained in a human-readable note. */
export function expectHistoryNote(note: unknown, contents: readonly string[]): void {
  expect(note).toEqual({ at: expect.any(String), reason: expect.any(String) });
  const record = note as { at: string; reason: string };
  expect(Number.isFinite(Date.parse(record.at))).toBe(true);
  expect(record.reason.trim()).not.toBe('');
  for (const content of contents) expect(record.reason).toContain(content);
}
