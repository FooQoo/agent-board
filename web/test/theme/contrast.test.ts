import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(
  join(resolve(import.meta.dirname, '../..'), 'src/styles/theme.css'),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '');

function tokens(selector: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (!(selectors ?? '').split(',').some((s) => s.trim() === selector)) continue;
    for (const [, name, value] of (body ?? '').matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{6})/g)) {
      if (name && value) out[name] = value;
    }
  }
  return out;
}

function luminance(hex: string): number {
  const channel = (i: number) => {
    const v = Number.parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe('text contrast of the neutral tokens', () => {
  const dark = tokens(':root[data-mode="dark"]');
  const light = { ...tokens(':root'), ...tokens(':root[data-mode="light"]') };

  it('dark: text, secondary and muted text read at 4.5:1 on every surface', () => {
    for (const text of ['--r-text', '--r-text2', '--r-muted']) {
      for (const ground of ['--r-surface', '--r-bg', '--r-lane']) {
        const value = ratio(dark[text] as string, dark[ground] as string);
        expect({ text, ground, ok: value >= 4.5 }).toEqual({ text, ground, ok: true });
      }
    }
  });

  it('dark: muted stays quieter than the secondary text', () => {
    expect(ratio(dark['--r-muted'] as string, dark['--r-surface'] as string)).toBeLessThan(
      ratio(dark['--r-text2'] as string, dark['--r-surface'] as string),
    );
  });

  it('light: the contrast of the neutral text tokens does not get worse', () => {
    expect(ratio(light['--r-text'] as string, light['--r-surface'] as string)).toBeGreaterThan(15);
    expect(ratio(light['--r-text2'] as string, light['--r-surface'] as string)).toBeGreaterThan(6);
    expect(ratio(light['--r-muted'] as string, light['--r-surface'] as string)).toBeGreaterThan(
      3.2,
    );
  });
});
