import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ACCENTS, MODES } from '../../src/theme';

const css = readFileSync(
  join(resolve(import.meta.dirname, '../..'), 'src/styles/theme.css'),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '');

/** Expected accent values (r-accent, r-accent-soft) per accent: [light, dark]. */
const DESIGN_ACCENT: Record<string, { accent: [string, string]; soft: [string, string] }> = {
  blue: { accent: ['#2563EB', '#6B9AFF'], soft: ['#E9EFFD', '#28354F'] },
  sky: { accent: ['#0284C7', '#4DB5F0'], soft: ['#E6F3F9', '#223B4C'] },
  cyan: { accent: ['#0891B2', '#3CC9E0'], soft: ['#E6F4F7', '#1E3F49'] },
  teal: { accent: ['#0D9488', '#3DCBB8'], soft: ['#E7F4F3', '#1F3F41'] },
  green: { accent: ['#16A34A', '#4CC97A'], soft: ['#E8F6ED', '#223F34'] },
  lime: { accent: ['#65A30D', '#A3D94A'], soft: ['#F0F6E7', '#33422B'] },
  yellow: { accent: ['#CA8A04', '#F0C531'], soft: ['#FAF3E6', '#423E26'] },
  orange: { accent: ['#EA580C', '#F59A52'], soft: ['#FDEEE7', '#43352C'] },
  red: { accent: ['#DC2626', '#F47C7C'], soft: ['#FCE9E9', '#432F35'] },
  pink: { accent: ['#DB2777', '#F472B6'], soft: ['#FBE9F1', '#432D40'] },
  purple: { accent: ['#7C3AED', '#A78BFA'], soft: ['#F2EBFD', '#34324E'] },
  gray: { accent: ['#475569', '#94A3B8'], soft: ['#EDEEF0', '#303741'] },
};

/** Declarations merged from every rule whose selector list contains `selector`. */
function declarations(selector: string): Record<string, string> {
  const out: Record<string, string> = {};
  let found = false;
  for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const list = (selectors ?? '').split(',').map((s) => s.trim());
    if (!list.includes(selector)) continue;
    found = true;
    for (const [, name, value] of (body ?? '').matchAll(/(--[\w-]+):\s*([^;]+);/g)) {
      if (name && value) out[name] = value.trim();
    }
  }
  if (!found) throw new Error(`no rule for ${selector}`);
  return out;
}

describe('theme.css', () => {
  it('has the accent tokens of every mode/accent combination, matching the design values', () => {
    for (const [mi, mode] of MODES.entries()) {
      for (const accent of ACCENTS) {
        const rule = declarations(`:root[data-mode="${mode}"][data-accent="${accent}"]`);
        const expected = DESIGN_ACCENT[accent];
        expect(rule['--r-accent']?.toUpperCase(), `${mode}/${accent}`).toBe(expected?.accent[mi]);
        expect(rule['--r-accent-soft']?.toUpperCase(), `${mode}/${accent}`).toBe(
          expected?.soft[mi],
        );
      }
    }
  });

  it('separates neutral, status and accent tokens per mode', () => {
    const light = declarations(':root[data-mode="light"]');
    const dark = declarations(':root[data-mode="dark"]');
    for (const name of [
      '--r-bg',
      '--r-surface',
      '--r-lane',
      '--r-border',
      '--r-text',
      '--r-text2',
      '--r-muted',
      '--r-on-accent',
      '--r-pend-bg',
      '--r-pend-bd',
      '--r-pend-tx',
      '--r-danger',
      '--r-done',
    ]) {
      expect(light[name], name).toBeDefined();
      expect(dark[name], name).toBeDefined();
      expect(light[name]).not.toBe(dark[name]);
    }
    expect(light['--r-bg']?.toUpperCase()).toBe('#F6F7F9');
    expect(dark['--r-bg']?.toUpperCase()).toBe('#0F1318');
    expect(light['--r-accent']).toBeUndefined();
    expect(dark['--r-pend-tx']?.toUpperCase()).toBe('#E9B04F');
  });

  it('falls back to light/blue when no attribute is set', () => {
    expect(declarations(':root')['--r-bg']).toBeDefined();
    expect(declarations(':root')['--r-accent']?.toUpperCase()).toBe('#2563EB');
  });
});
