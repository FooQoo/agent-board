import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

/** Evaluates `clamp(min, calc(min + (100vw - 1024px) * k), max)` at a viewport width. */
function evalClamp(expr: string, vw: number): number {
  const m = expr.match(
    /clamp\((\d+)px,\s*calc\(\1px \+ \(100vw - 1024px\) \* ([\d.]+)\),\s*(\d+)px\)/,
  );
  if (!m) throw new Error(`unexpected clamp: ${expr}`);
  const [min, k, max] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return Math.min(max, Math.max(min, min + (vw - 1024) * k));
}

function wideTokens(): string {
  const css = read('src/styles/tokens.css');
  const start = css.indexOf('@media (min-width: 1024px)');
  expect(start).toBeGreaterThan(-1);
  return css.slice(start);
}

function token(block: string, name: string): string {
  const m = block.match(new RegExp(`${name}:\\s*([^;]+);`));
  if (!m) throw new Error(`missing ${name}`);
  const value = m[1];
  if (value === undefined) throw new Error(`missing ${name}`);
  return value.trim();
}

describe('wide layout tokens', () => {
  const block = wideTokens();

  it('defines fixed header height and block inset', () => {
    expect(token(block, '--header-height')).toBe('56px');
    expect(token(block, '--board-inset-block')).toBe('40px');
  });

  it('shrinks the left inset and keeps the header-right inset at 24px', () => {
    const e = token(block, '--inset-left');
    expect(evalClamp(e, 1024)).toBe(24);
    expect(evalClamp(e, 1152)).toBe(44);
    expect(evalClamp(e, 1280)).toBe(64);
    expect(evalClamp(e, 1920)).toBe(64);
    expect(token(block, '--inset-right-header')).toBe('24px');
  });

  it('shrinks the board right inset from 40px to 24px', () => {
    const e = token(block, '--inset-right-board');
    expect(evalClamp(e, 1024)).toBe(24);
    expect(evalClamp(e, 1280)).toBe(40);
    expect(evalClamp(e, 2000)).toBe(40);
  });

  it('keeps the narrow tokens untouched', () => {
    const css = read('src/styles/tokens.css');
    expect(css).toContain('--header-height: 80px;');
    expect(css).toContain('--page-gutter: var(--space-40);');
    expect(css).toContain('--board-padding: var(--space-24);');
  });
});

describe('wide layout rules', () => {
  const css = read('src/styles/app.css');
  const wide = css.slice(css.indexOf('@media (min-width: 1024px)'));
  const rule = (sel: string) => {
    const m = wide.match(new RegExp(`\\n  ${sel.replace(/[.[\]]/g, '\\$&')}\\s*\\{([^}]*)\\}`));
    if (!m) throw new Error(`missing rule ${sel}`);
    return m[1];
  };

  it('uses the insets for header, board and status bar', () => {
    expect(rule('.header')).toMatch(
      /padding:\s*0 var\(--inset-right-header\) 0 var\(--inset-left\)/,
    );
    expect(rule('.board__lanes')).toMatch(
      /padding:\s*var\(--board-inset-block\)\s+var\(--inset-right-board\)\s+var\(--board-inset-block\)\s+var\(--inset-left\)/,
    );
    expect(rule('.status-bar')).toMatch(
      /padding:\s*0 var\(--inset-right-board\) 0 var\(--inset-left\)/,
    );
  });

  it('keeps the detail column definition', () => {
    expect(rule('.app__body')).toContain(
      'grid-template-columns: minmax(0, 1fr) var(--detail-width)',
    );
  });
});
