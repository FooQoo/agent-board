import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const STYLES = join(import.meta.dirname, '../src/styles');
const files = readdirSync(STYLES).filter((name) => name.endsWith('.css'));

describe('typography', () => {
  it('uses the app font tokens, not named document faces', () => {
    for (const name of files) {
      const css = readFileSync(join(STYLES, name), 'utf8');
      expect(css, name).not.toMatch(/Noto (Sans|Serif) JP|IBM Plex Mono/);
    }
  });

  it('has no chapter number chip or oversized headings in the editor body', () => {
    const css = files.map((name) => readFileSync(join(STYLES, name), 'utf8')).join('\n');
    expect(css).not.toContain('md-chapter__number');
    expect(css).not.toContain('counter(chapter');
    expect(css).not.toMatch(/font-size: (31|35|23|32|17)px/);
  });
});
