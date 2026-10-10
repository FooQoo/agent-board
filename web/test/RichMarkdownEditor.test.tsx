import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  RichMarkdownEditor,
  type RichMarkdownEditorHandle,
} from '../src/components/editor/RichMarkdownEditor';
import { CODE_LANGUAGES, MermaidPreviews } from '../src/components/editor/RichMarkdownEditor.impl';
import { selectLocale } from '../src/i18n';

const { draw, initialize } = vi.hoisted(() => ({ draw: vi.fn(), initialize: vi.fn() }));

vi.mock('mermaid', () => ({
  default: {
    initialize,
    render: draw,
  },
}));

const ID = '0123456789abcdef0123456789abcdef';
const OTHER = 'fedcba9876543210fedcba9876543210';

/** A body with the shapes the editor must keep: criteria, nesting, images, mermaid, code, `*` bullets. */
const SAMPLE = [
  '## 目的',
  '',
  '本文は *そのまま* 残す。',
  '',
  '## 完了条件と確認結果',
  '',
  '* [ ] AC-1. 一つ目',
  '    * 入れ子の項目',
  '* [x] AC-2. 二つ目',
  '',
  `![図: 一枚目](assets/${ID}.png)`,
  `![図: 二枚目](attachment:${OTHER} "題")`,
  '',
  '```mermaid',
  'flowchart TD',
  '  A --> B',
  '```',
  '',
  '```ts',
  'const x = 1;',
  '```',
  '',
  '## 三つ目',
  '',
  '1) 番号の付け方が違う項目',
  '2) 二つ目',
  '',
].join('\n');

/** A body already in the form the editor writes, so an edit of one line can be compared exactly. */
const CANONICAL = ['## 完了条件', '', '- [ ] AC-1. 一つ目', '- [x] AC-2. 二つ目', ''].join('\n');

function resolveAttachment(id: string): string | null {
  return id === ID ? `blob:${id}` : null;
}

beforeEach(() => {
  selectLocale('en');
  draw.mockReset();
  initialize.mockClear();
  draw.mockImplementation(async (id: string, source: string) => {
    if (source.includes('BROKEN')) throw new Error('Parse error on line 2:\nBROKEN');
    return { svg: `<svg id="${id}"></svg>` };
  });
});

afterEach(() => {
  cleanup();
});

async function mounted(
  value: string,
  onChange = vi.fn(),
  extra: Partial<Parameters<typeof RichMarkdownEditor>[0]> = {},
) {
  const ref = createRef<RichMarkdownEditorHandle>();
  const utils = render(
    <RichMarkdownEditor
      value={value}
      onChange={onChange}
      aria-label="Description"
      resolveAttachment={resolveAttachment}
      ref={ref}
      {...extra}
    />,
  );
  await waitFor(() => expect(document.querySelector('.ProseMirror')).toBeTruthy());
  await waitFor(() => expect(ref.current).not.toBeNull());
  return { ...utils, ref, onChange };
}

describe('RichMarkdownEditor', () => {
  it('returns the original text and reports nothing when the body is opened and left alone', async () => {
    const { ref, onChange } = await mounted(SAMPLE);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(ref.current?.markdown()).toBe(SAMPLE);
  });

  it('reports a change only when the reader changes the text, and keeps the other lines of the criteria', async () => {
    const { ref, onChange } = await mounted(CANONICAL);
    await act(async () => {
      ref.current?.goTo(0);
    });
    expect(onChange).not.toHaveBeenCalled();
    const wrapper = document.querySelector<HTMLElement>('.ProseMirror li.list-item .label-wrapper');
    expect(wrapper).toBeTruthy();
    await act(async () => {
      fireEvent.pointerDown(wrapper as HTMLElement);
    });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const next = onChange.mock.calls.at(-1)?.[0] as string;
    expect(next.split('\n').filter((line) => line !== '')).toEqual([
      '## 完了条件',
      '- [x] AC-1. 一つ目',
      '- [x] AC-2. 二つ目',
    ]);
  });

  it('keeps an image with a title and one without, with the alt text unchanged, when a paragraph is edited', async () => {
    const { ref, onChange } = await mounted(SAMPLE);
    await act(async () => {
      ref.current?.goTo(0);
      ref.current?.insert('追加 ');
    });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const next = onChange.mock.calls.at(-1)?.[0] as string;
    expect(next).toContain(`![図: 一枚目](assets/${ID}.png)`);
    expect(next).toContain(`![図: 二枚目](attachment:${OTHER} "題")`);
  });

  it('draws the body with images the reader can see: an owned reference shows its picture, an unowned one No image', async () => {
    const { container } = await mounted(SAMPLE);
    await waitFor(() => expect(container.querySelector('img')).toBeTruthy());
    expect(container.querySelector(`img[src="blob:${ID}"]`)?.getAttribute('alt')).toBe(
      '図: 一枚目',
    );
    expect(screen.getAllByText('No image').length).toBeGreaterThan(0);
  });

  it('goes to the nth second-level heading, and reports the heading the cursor is in', async () => {
    const onCursorChange = vi.fn();
    const { ref } = await mounted(SAMPLE, vi.fn(), { onCursorChange });
    await act(async () => {
      ref.current?.goTo(2);
    });
    await waitFor(() => expect(onCursorChange).toHaveBeenCalledWith(SAMPLE.indexOf('## 三つ目')), {
      timeout: 3000,
    });
    await act(async () => {
      ref.current?.goTo(1);
    });
    await waitFor(
      () =>
        expect(onCursorChange).toHaveBeenLastCalledWith(SAMPLE.indexOf('## 完了条件と確認結果')),
      { timeout: 3000 },
    );
  });

  it('takes the new text from outside when the value changes, and not when it is the text it reported', async () => {
    const onChange = vi.fn();
    const ref = createRef<RichMarkdownEditorHandle>();
    const element = (value: string) => (
      <RichMarkdownEditor value={value} onChange={onChange} aria-label="Description" ref={ref} />
    );
    const { rerender } = render(element(CANONICAL));
    await waitFor(() => expect(ref.current).not.toBeNull());
    rerender(element('## 別の本文\n'));
    await waitFor(() => expect(ref.current?.markdown()).toBe('## 別の本文\n'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('gives the current text at once after an edit, before the change is reported', async () => {
    const { ref } = await mounted(CANONICAL);
    await act(async () => {
      ref.current?.goTo(0);
      ref.current?.insert('即時');
    });
    expect(ref.current?.markdown()).toContain('即時');
  });

  it('keeps a mermaid block in the text, even when it is wrong', async () => {
    const broken = '## 図\n\n```mermaid\nflowchart TD\n  BROKEN\n```\n';
    const { ref, onChange } = await mounted(broken);
    await act(async () => {
      ref.current?.insert('x');
    });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.calls.at(-1)?.[0]).toContain('```mermaid\nflowchart TD\n  BROKEN\n```');
  });

  it('does not load the Crepe theme or the block, LaTeX, top bar, or AI features', () => {
    const source = readFileSync(
      join(import.meta.dirname, '../src/components/editor/RichMarkdownEditor.impl.tsx'),
      'utf8',
    );
    expect(source).not.toMatch(/crepe\/theme/);
    expect(source).not.toMatch(/feature\/(block-edit|latex|top-bar|ai)/);
  });
});

describe('mermaid preview in code blocks', () => {
  const root = document.documentElement;

  afterEach(() => {
    root.style.removeProperty('--r-accent');
  });

  it('draws a mermaid block into the given element', async () => {
    const previews = new MermaidPreviews();
    const apply = vi.fn();
    previews.render('mermaid', 'flowchart TD\n  P1 --> Q1', apply);
    await waitFor(() => expect(apply).toHaveBeenCalled());
    const element = apply.mock.calls[0]?.[0] as HTMLElement;
    expect(element.querySelector('svg')).toBeTruthy();
    previews.dispose();
  });

  it('shows one line of the error for a wrong mermaid block, and does not reject the save', async () => {
    const previews = new MermaidPreviews();
    const apply = vi.fn();
    previews.render('mermaid', 'flowchart TD\n  BROKEN', apply);
    await waitFor(() => expect(apply).toHaveBeenCalled());
    const element = apply.mock.calls[0]?.[0] as HTMLElement;
    expect(element.getAttribute('role')).toBe('alert');
    expect(element.textContent).toBe('The diagram cannot be drawn: Parse error on line 2:');
    previews.dispose();
  });

  it('leaves other languages without a preview', () => {
    const previews = new MermaidPreviews();
    const apply = vi.fn();
    expect(previews.render('ts', 'const x = 1;', apply)).toBeNull();
    expect(apply).not.toHaveBeenCalled();
    previews.dispose();
  });

  it('redraws a preview when the page theme changes, and draws it again in the new colors', async () => {
    const previews = new MermaidPreviews();
    const apply = vi.fn();
    previews.render('mermaid', 'flowchart TD\n  T1 --> T2', apply);
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));

    root.style.setProperty('--r-accent', '#ff0000');
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(2));
    expect(draw).toHaveBeenCalledTimes(2);
    const colors = initialize.mock.calls.at(-1)?.[0].themeVariables as Record<string, string>;
    expect(colors.primaryBorderColor).toBe('#ff0000');
    previews.dispose();
  });

  it('does not redraw when the page changes without a change of its theme', async () => {
    const previews = new MermaidPreviews();
    const apply = vi.fn();
    previews.render('mermaid', 'flowchart TD\n  U1 --> U2', apply);
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    root.setAttribute('data-unrelated', 'x');
    await new Promise((resolve) => setTimeout(resolve, 20));
    root.removeAttribute('data-unrelated');
    expect(draw).toHaveBeenCalledTimes(1);
    previews.dispose();
  });

  it('stops redrawing after it is disposed', async () => {
    const previews = new MermaidPreviews();
    const apply = vi.fn();
    previews.render('mermaid', 'flowchart TD\n  V1 --> V2', apply);
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    previews.dispose();
    root.style.setProperty('--r-accent', '#00ff00');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(apply).toHaveBeenCalledTimes(1);
  });
});

describe('mermaid previews in the editor', () => {
  it('draws the mermaid block of the body again when the page theme changes', async () => {
    const body = '## 図\n\n```mermaid\nflowchart TD\n  E1 --> E2\n```\n';
    await mounted(body);
    await waitFor(() => expect(draw).toHaveBeenCalled());
    const before = draw.mock.calls.length;
    document.documentElement.style.setProperty('--r-accent', '#0000ff');
    await waitFor(() => expect(draw.mock.calls.length).toBeGreaterThan(before));
    const colors = initialize.mock.calls.at(-1)?.[0].themeVariables as Record<string, string>;
    expect(colors.primaryBorderColor).toBe('#0000ff');
    document.documentElement.style.removeProperty('--r-accent');
  });

  it('offers the code languages of the language data, not only Markdown', () => {
    expect(CODE_LANGUAGES.length).toBeGreaterThan(20);
    expect(CODE_LANGUAGES.some((language) => language.name === 'TypeScript')).toBe(true);
  });
});

describe('a pasted picture reference', () => {
  function paste(text: string) {
    const target = document.querySelector('.ProseMirror') as HTMLElement;
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
      value: {
        getData: (type: string) => (type === 'text/plain' ? text : ''),
        types: ['text/plain'],
        files: [],
      },
    });
    act(() => {
      target.dispatchEvent(event);
    });
  }

  it('keeps no title when the reference had none, so saving does not write the alt text as one', async () => {
    const { ref } = await mounted('Intro');
    paste('![found](https://example.com/ok.png)');
    await waitFor(() => expect(ref.current?.markdown()).toContain('found'));
    expect(ref.current?.markdown()).toContain('![found](https://example.com/ok.png)');
    expect(ref.current?.markdown()).not.toContain('"found"');
  });

  it('keeps a title the reference has', async () => {
    const { ref } = await mounted('Intro');
    paste('![found](https://example.com/ok.png "Shot")');
    await waitFor(() => expect(ref.current?.markdown()).toContain('found'));
    expect(ref.current?.markdown()).toContain('![found](https://example.com/ok.png "Shot")');
  });
});
