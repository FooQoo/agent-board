import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

/** The declarations of the first rule whose selector list contains `selector` exactly. */
function rule(css: string, selector: string): string {
  const pattern = new RegExp(
    `(?:^|\\})\\s*(?:[^{}]*,\\s*)?${selector.replace(/[.[\]()]/g, '\\$&')}\\s*(?:,[^{}]*)?\\{([^}]*)\\}`,
    'm',
  );
  const match = css.match(pattern);
  if (!match?.[1]) throw new Error(`missing rule ${selector}`);
  return match[1];
}

describe('desktop layout', () => {
  const css = read('src/styles/app.css');

  it('stacks the header, the body and the status bar to the full viewport height', () => {
    expect(rule(css, '.app')).toMatch(/height:\s*100dvh/);
    expect(rule(css, '.header')).toMatch(/height:\s*56px/);
    expect(rule(css, '.header')).toMatch(/padding:\s*0 24px/);
    expect(rule(css, '.app')).toMatch(/grid-template-rows:\s*56px minmax\(0, 1fr\) 40px/);
    expect(rule(css, '.status-bar')).toMatch(/padding:\s*0 24px/);
  });

  it('puts the board and the detail column side by side with the stored detail width', () => {
    expect(rule(css, '.app__body')).toContain(
      'grid-template-columns: minmax(0, 1fr) var(--detail-width)',
    );
  });

  it('uses the same board padding, lane gap and lane padding at every width', () => {
    expect(rule(css, '.board__lanes')).toMatch(/padding:\s*24px/);
    expect(rule(css, '.board__lanes')).toMatch(/gap:\s*16px/);
    expect(rule(css, '.board__lanes')).toMatch(
      /grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/,
    );
    expect(rule(css, '.lane')).toMatch(/padding:\s*12px/);
    expect(rule(css, '.lane')).toMatch(/border-radius:\s*var\(--radius-lane\)/);
  });

  it('draws the detail column with a left border, 28px padding and a scrolling tab content', () => {
    const detail = rule(css, '.detail');
    expect(detail).toMatch(/padding:\s*28px/);
    expect(detail).toMatch(/border-left:\s*1px solid var\(--r-border\)/);
    expect(detail).toMatch(/gap:\s*18px/);
    const viewport = rule(read('src/styles/detail.css'), '.detail__viewport');
    expect(viewport).toMatch(/overflow-y:\s*auto/);
  });
});
