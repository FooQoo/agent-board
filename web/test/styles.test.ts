import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

/**
 * Design token values the history timeline uses (light values at the blue accent; dark values
 * below). The neutral palette is defined in theme.css as the r-* tokens.
 */
const DESIGN_LIGHT: Record<string, string> = {
  'text-primary': '#1A4FB8',
  'text-secondary': '#4A64A8',
  divider: '#8CC6EE',
  todo: '#6E62A8',
  doing: '#1F6FEB',
  done: '#3E968A',
  'pending-text': '#D9650B',
};

const DESIGN_DARK: Record<string, string> = {
  'text-primary': '#E7EAEE',
  'text-secondary': '#A3ACB9',
  divider: '#3A4452',
  todo: '#A99BEA',
  doing: '#6B9AFF',
  done: '#5CC4A0',
  'pending-text': '#E9B04F',
};

function sourceFiles(dir: string): string[] {
  return readdirSync(join(root, dir)).flatMap((name) => {
    const path = join(dir, name);
    return statSync(join(root, path)).isDirectory() ? sourceFiles(path) : [path];
  });
}

describe('tokens.css', () => {
  const tokens = read('src/styles/tokens.css').toLowerCase();
  const dark = tokens.slice(tokens.indexOf(':root[data-mode="dark"]'));

  it.each(Object.entries(DESIGN_LIGHT))('defines the light design token %s', (name, value) => {
    expect(tokens).toContain(`--${name}: ${value.toLowerCase()};`);
  });

  it.each(Object.entries(DESIGN_DARK))('defines the dark design token %s', (name, value) => {
    expect(dark).toContain(`--${name}: ${value.toLowerCase()};`);
  });

  it('defines the radius tokens and uses system font stacks', () => {
    expect(tokens).toContain('--radius-card: 10px;');
    expect(tokens).toContain('--radius-lane: 12px;');
    expect(tokens).toMatch(/--font-sans:\s*system-ui/);
    expect(tokens).toMatch(/--font-mono:\s*ui-monospace/);
    expect(tokens).toMatch(/--font-serif:\s*ui-serif/);
    expect(tokens).not.toContain('@font-face');
    expect(tokens).not.toContain('url(');
  });

  it('has no width-dependent tokens: the desktop layout is the only layout', () => {
    expect(tokens).not.toMatch(/@media[^{]*(min|max)-width/);
    expect(tokens).not.toContain('100vw');
  });
});

describe('app.css', () => {
  const css = read('src/styles/app.css');

  it('takes every color from the theme tokens instead of literals', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\brgba?\(/);
  });

  it('keeps narrow archive layouts inside the app surface', () => {
    expect(read('src/styles/archive.css')).toMatch(/@media[^{]*max-width/);
    expect(read('src/styles/resize.css')).not.toMatch(/@media[^{]*(min|max)-width/);
  });

  it('does not override the Tailwind button utilities with an unlayered button rule', () => {
    expect(css).not.toMatch(/^button\s*\{/m);
    expect(css).not.toMatch(/\.button(--[a-z]+)?\s*\{/);
    expect(css).not.toMatch(/\.icon-button\s*\{/);
  });

  it('keeps the history reason line breaks and stops the spinner for reduced motion', () => {
    expect(css).toMatch(/\.history__reason\s*\{[^}]*white-space:\s*pre-wrap/);
    expect(css).toMatch(
      /prefers-reduced-motion:\s*reduce\)\s*\{[^}]*\.spinner[^}]*animation:\s*none/,
    );
  });

  it('spins the loader on the board task only', () => {
    expect(css).toMatch(/\.card \.spinner\s*\{[^}]*animation:\s*spin/);
    expect(css).not.toMatch(/(^|\n)\.spinner\s*\{[^}]*animation:\s*spin/);
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
    expect(read('index.html')).toContain('<meta name="agboard-token" content="{{AGBOARD_TOKEN}}"');
  });
});
