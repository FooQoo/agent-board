import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ledgerRows, readStoryCoverage } from '../.storybook/support/coverage';

const SRC = join(import.meta.dirname, '../src');

describe('story coverage files', () => {
  it('match the coverage format, and every listed part exists', () => {
    const { files, problems } = readStoryCoverage(SRC);
    expect(problems).toEqual([]);
    expect(files.length).toBeGreaterThanOrEqual(6);
    expect(ledgerRows(files).length).toBeGreaterThan(0);
  });
});
