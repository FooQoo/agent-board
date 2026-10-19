import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(import.meta.dirname, '../src');
// Every stylesheet under src/, wherever it sits beside the code it styles.
const files = readdirSync(SRC, { recursive: true, encoding: 'utf8' })
  .filter((name) => name.endsWith('.css'))
  .sort();

describe('typography', () => {
  it('finds the stylesheets', () => {
    expect(files.length).toBeGreaterThan(18);
  });

  it('uses the app font tokens, not named document faces', () => {
    for (const name of files) {
      const css = readFileSync(join(SRC, name), 'utf8');
      expect(css, name).not.toMatch(/Noto (Sans|Serif) JP|IBM Plex Mono/);
    }
  });

  it('has no chapter number chip or oversized headings in the editor body', () => {
    const read = (list: string[]) =>
      list.map((name) => readFileSync(join(SRC, name), 'utf8')).join('\n');
    const css = read(files);
    expect(css).not.toContain('md-chapter__number');
    expect(css).not.toContain('counter(chapter');
    // The phone monitor's drawer title is 17px by design; it is not an editor body.
    expect(read(files.filter((name) => name !== 'pages/monitor/monitor.css'))).not.toMatch(
      /font-size: (31|35|23|32|17)px/,
    );
  });
});
