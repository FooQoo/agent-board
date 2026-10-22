import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { initialize, render } = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(),
}));

vi.mock('mermaid', () => ({ default: { initialize, render } }));

import { mermaidThemeFromCss, renderMermaid } from '../src/shared/markdown/mermaid';

const root = document.documentElement;

beforeEach(() => {
  initialize.mockClear();
  render.mockReset();
  render.mockImplementation(async (id: string, source: string) => {
    if (source.includes('BROKEN')) {
      throw new Error('Parse error on line 2:\nflowchart TD\nExpecting SQE, got BROKEN');
    }
    return { svg: `<svg data-id="${id}" data-source="${source.length}"></svg>` };
  });
});

afterEach(() => {
  root.style.removeProperty('--r-text');
  root.style.removeProperty('--r-accent');
});

describe('renderMermaid', () => {
  it('draws the source with the strict security level, SVG-text labels and the theme variables', async () => {
    const theme = mermaidThemeFromCss();
    const result = await renderMermaid('flowchart TD\n  A1 --> B1', theme);
    expect(result).toEqual({ ok: true, svg: expect.stringContaining('<svg') });
    expect(initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        startOnLoad: false,
        securityLevel: 'strict',
        htmlLabels: false,
        theme: 'base',
        themeVariables: theme.variables,
      }),
    );
  });

  it('gives every drawing its own element id', async () => {
    const theme = mermaidThemeFromCss();
    await renderMermaid('flowchart TD\n  A2 --> B2', theme);
    await renderMermaid('flowchart TD\n  A3 --> B3', theme);
    const ids = render.mock.calls.map((call) => call[0]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toMatch(/^[A-Za-z][\w-]*$/);
  });

  it('returns one line of the error and keeps the source out of the result', async () => {
    const result = await renderMermaid('flowchart TD\n  BROKEN', mermaidThemeFromCss());
    expect(result).toEqual({
      ok: false,
      message: 'Parse error on line 2:',
    });
  });

  it('reuses the drawing for the same source and theme, and draws again for another theme', async () => {
    const source = 'flowchart TD\n  C1 --> D1';
    const theme = mermaidThemeFromCss();
    const first = await renderMermaid(source, theme);
    const second = await renderMermaid(source, theme);
    expect(second).toEqual(first);
    expect(render).toHaveBeenCalledTimes(1);

    root.style.setProperty('--r-text', '#abcdef');
    const other = mermaidThemeFromCss();
    expect(other.id).not.toBe(theme.id);
    await renderMermaid(source, other);
    expect(render).toHaveBeenCalledTimes(2);
  });

  it('draws one diagram after another, so the theme of each one is applied', async () => {
    const light = mermaidThemeFromCss();
    root.style.setProperty('--r-accent', '#123456');
    const dark = mermaidThemeFromCss();
    await Promise.all([
      renderMermaid('flowchart TD\n  E1 --> F1', light),
      renderMermaid('flowchart TD\n  E2 --> F2', dark),
    ]);
    const variables = initialize.mock.calls.map((call) => call[0].themeVariables);
    expect(variables).toEqual([light.variables, dark.variables]);
  });
});

describe('mermaidThemeFromCss', () => {
  it('builds the variables from the CSS variables of the page', () => {
    root.style.setProperty('--r-text', '#101010');
    root.style.setProperty('--r-accent', '#202020');
    const theme = mermaidThemeFromCss();
    expect(theme.variables.primaryTextColor).toBe('#101010');
    expect(theme.variables.primaryBorderColor).toBe('#202020');
  });

  it('has a stable id for the same values', () => {
    expect(mermaidThemeFromCss().id).toBe(mermaidThemeFromCss().id);
  });
});
