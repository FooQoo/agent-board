import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

/** Variables of the approved design at the time of the approved mock (2026-10-03). */
const DESIGN_COLORS: Record<string, string> = {
  primary: '#1F6FEB',
  'primary-strong': '#1A4FB8',
  'text-primary': '#1A4FB8',
  'text-secondary': '#4A64A8',
  'text-muted': '#6F84B8',
  'on-primary': '#FFFFFF',
  'accent-cyan': '#5ED1F2',
  surface: '#FFFFFF',
  lane: '#EEF5FC',
  'card-border': '#A9D6F0',
  divider: '#8CC6EE',
  line: '#2F6BDB',
  badge: '#D7ECFB',
  selected: '#1F4FD1',
  'pending-bg': '#FFF8DE',
  'pending-border': '#F1D27C',
  'pending-text': '#D9650B',
  todo: '#6E62A8',
  doing: '#1F6FEB',
  done: '#3E968A',
  danger: '#E2342D',
};

function sourceFiles(dir: string): string[] {
  return readdirSync(join(root, dir)).flatMap((name) => {
    const path = join(dir, name);
    return statSync(join(root, path)).isDirectory() ? sourceFiles(path) : [path];
  });
}

describe('tokens.css', () => {
  const tokens = read('src/styles/tokens.css').toLowerCase();

  it.each(Object.entries(DESIGN_COLORS))('mirrors the design variable %s', (name, value) => {
    expect(tokens).toContain(`--${name}: ${value.toLowerCase()};`);
  });

  it('mirrors the radius variables and uses system font stacks', () => {
    expect(tokens).toContain('--radius-card: 10px;');
    expect(tokens).toContain('--radius-lane: 12px;');
    expect(tokens).toMatch(/--font-sans:\s*system-ui/);
    expect(tokens).toMatch(/--font-mono:\s*ui-monospace/);
    expect(tokens).toMatch(/--font-serif:\s*ui-serif/);
    expect(tokens).not.toContain('@font-face');
    expect(tokens).not.toContain('url(');
  });
});

describe('app.css', () => {
  const css = read('src/styles/app.css');

  it('takes colors, sizes and spacing from tokens instead of literals', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    const declarations = css.split('\n').filter((line) => /^\s+[a-z-]+:/.test(line));
    const withLiteralLengths = declarations.filter((line) =>
      /(^|[\s(])\d*\.?\d+(px|rem|em)\b/.test(line),
    );
    expect(withLiteralLengths).toEqual([]);
  });

  it('keeps the description line breaks and stops the spinner for reduced motion', () => {
    expect(css).toMatch(/\.detail__description\s*\{[^}]*white-space:\s*pre-wrap/);
    expect(css).toMatch(
      /prefers-reduced-motion:\s*reduce\)\s*\{\s*\.spinner\s*\{\s*animation:\s*none/,
    );
  });

  it('has the 1024px and 640px breakpoints', () => {
    expect(css).toContain('(min-width: 1024px)');
    expect(css).toContain('(max-width: 639px)');
  });
});

describe('source rules', () => {
  const files = sourceFiles('src').filter((f) => /\.(ts|tsx|css)$/.test(f));

  it('never uses dangerouslySetInnerHTML', () => {
    const offenders = files.filter((f) => read(f).includes('dangerouslySetInnerHTML'));
    expect(offenders).toEqual([]);
  });

  it('does not load anything from outside (CDN, web fonts, remote images)', () => {
    const offenders = files.filter((f) => /https?:\/\/(?!www\.w3\.org)/.test(read(f)));
    expect(offenders).toEqual([]);
  });
});

describe('index.html', () => {
  it('carries the session token placeholder for the server to replace', () => {
    expect(read('index.html')).toContain('<meta name="skan-token" content="{{SKAN_TOKEN}}"');
  });
});
