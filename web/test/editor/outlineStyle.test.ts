import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const CSS = join(import.meta.dirname, '../../src/shared/styles');

/** The declarations of the first rule whose selector is exactly `selector`. */
function rule(css: string, selector: string): string {
  const start = css.indexOf(`\n${selector} {`);
  if (start === -1) throw new Error(`no rule for ${selector}`);
  return css.slice(start, css.indexOf('}', start));
}

describe('the contents list', () => {
  it('has a white surface, which the dark theme redefines, not the page background', () => {
    const css = readFileSync(join(CSS, 'editor.css'), 'utf8');
    const side = rule(css, '.editor__side');
    expect(side).toContain('background: var(--r-surface);');
    expect(side).not.toContain('var(--r-bg)');
  });
});
