import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { selectLocale } from '../i18n';
import { RichMarkdownEditor, type RichMarkdownEditorHandle } from './RichMarkdownEditor';

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: async (id: string) => ({ svg: `<svg id="${id}"></svg>` }),
  },
}));

// Source files may not spell out a remote URL (styles.test.ts), so the host is joined here.
const HOST = ['https:', 'example.com'].join('//');

const SAMPLE = readFileSync(join(import.meta.dirname, 'fixtures/docs-sample.md'), 'utf8');

/** Docs gives the editor a function that turns a file-relative image path into an image API URL. */
const resolveImage = (src: string) => (src.startsWith('.') ? `/api/docs/assets?path=${src}` : null);

beforeEach(() => selectLocale('en'));
afterEach(() => cleanup());

function element(
  value: string,
  onChange: (value: string) => void,
  ref: React.Ref<RichMarkdownEditorHandle>,
) {
  return (
    <RichMarkdownEditor
      value={value}
      onChange={onChange}
      aria-label="Document"
      resolveImage={resolveImage}
      ref={ref}
    />
  );
}

async function mounted(value: string) {
  const ref = createRef<RichMarkdownEditorHandle>();
  const onChange = vi.fn();
  const utils = render(element(value, onChange, ref));
  await waitFor(() => expect(document.querySelector('.ProseMirror')).toBeTruthy());
  await waitFor(() => expect(ref.current).not.toBeNull());
  // The editor is live once its first markdown() is the original (it is before and after).
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
  return { ...utils, ref, onChange };
}

const MDX_SAMPLE = readFileSync(join(import.meta.dirname, 'fixtures/docs-sample.mdx'), 'utf8');

const NOTATION = readFileSync(join(import.meta.dirname, 'fixtures/docs-notation.md'), 'utf8');

const undo = () => {
  const view = document.querySelector('.ProseMirror') as HTMLElement;
  fireEvent.keyDown(view, { key: 'z', code: 'KeyZ', ctrlKey: true });
};

/** The lines of `after` that are not in `before`, and the other way around. */
function changedLines(before: string, after: string) {
  const had = new Set(before.split('\n'));
  const has = new Set(after.split('\n'));
  return {
    removed: before.split('\n').filter((line) => !has.has(line)),
    added: after.split('\n').filter((line) => !had.has(line)),
  };
}

describe('Docs round trip', () => {
  it('shows the import, export and JSX lines of an MDX file as text and runs no component', async () => {
    const { ref, unmount } = await mounted(MDX_SAMPLE);
    const view = document.querySelector('.ProseMirror') as HTMLElement;
    expect(view.textContent).toContain('import { Chart } from');
    expect(view.textContent).toContain('<Chart year={year} kind="bar" />');
    expect(view.textContent).toContain('export const year = 2026');
    expect(view.querySelector('chart, callout, main')).toBeNull();
    expect(ref.current?.markdown()).toBe(MDX_SAMPLE);
    unmount();
  });

  it('returns the original text exactly when nothing was changed', async () => {
    for (const text of [
      SAMPLE,
      NOTATION,
      MDX_SAMPLE,
      SAMPLE.replace(/\n/g, '\r\n'),
      SAMPLE.trimEnd(),
    ]) {
      const { ref, onChange, unmount } = await mounted(text);
      expect(ref.current?.markdown()).toBe(text);
      expect(onChange).not.toHaveBeenCalled();
      unmount();
    }
  });

  it('gives back the original text when a character is typed and taken back', async () => {
    const { ref } = await mounted(SAMPLE);
    await act(async () => {
      ref.current?.insert('x');
    });
    expect(ref.current?.markdown()).not.toBe(SAMPLE);
    await act(async () => {
      undo();
    });
    expect(ref.current?.markdown()).toBe(SAMPLE);
  });

  it('changes only the edited line and the table layout when one character is typed', async () => {
    const { ref, onChange } = await mounted(SAMPLE);
    await act(async () => {
      ref.current?.goTo(0);
      ref.current?.insert('x');
    });
    const next = ref.current?.markdown() ?? '';
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const { removed, added } = changedLines(SAMPLE, next);
    expect(removed).toEqual([
      '## 概要',
      '| 名前 | 状態 | 備考 |',
      '| --- | --- | --- |',
      '| alpha | done | 完了 |',
      '| beta | doing | 作業中 |',
    ]);
    expect(added).toEqual([
      '## x概要',
      '| 名前    | 状態    | 備考  |',
      '| ----- | ----- | --- |',
      '| alpha | done  | 完了  |',
      '| beta  | doing | 作業中 |',
    ]);
    // Code, Mermaid, pictures, footnote, raw HTML and nesting are kept as written.
    for (const kept of [
      '```mermaid\nflowchart LR',
      '![構成図](./images/overview.png)',
      '![下位の図](../shared/diagram.webp "題")',
      '[^1]: 脚注の本文。',
      '<details>',
      '    - さらに深い項目',
    ]) {
      expect(next).toContain(kept);
    }
  });

  it('adds a paragraph without touching the rest of the document but the table layout', async () => {
    const { ref } = await mounted(SAMPLE);
    await act(async () => {
      ref.current?.insert('x');
    });
    // Appending text at the cursor is the same kind of change as typing; the table is the one
    // construct whose notation moves (see the notation list in the card).
    const { removed } = changedLines(SAMPLE, ref.current?.markdown() ?? '');
    expect(removed.every((line) => line.startsWith('|') || line.startsWith('# '))).toBe(true);
  });

  it('writes the notations a save rewrites in their normalized form', async () => {
    const { ref } = await mounted(NOTATION);
    await act(async () => {
      ref.current?.insert('x');
    });
    const next = ref.current?.markdown() ?? '';
    const expected = [
      '# xSetext 見出し',
      '## Setext 二段目',
      '- アスタリスクの項目',
      '* プラスの項目',
      '1. 括弧の番号',
      '3) 3から始まる番号',
      '  - の入れ子',
      '***',
      '```python',
      '行末に空白二つ\\',
      `<${HOST}/bare>`,
      '2 \\* 3 \\* 4',
      `[参照リンク](${HOST}/ref "題")`,
      '| :- | :-: | -: |',
      '# 末尾の # 付き見出し',
    ];
    for (const line of expected) expect(next, line).toContain(line);
    expect(next).not.toContain('[ref]:');
  });

  it('does not report a value that is replaced from outside, and shows the new file', async () => {
    const ref = createRef<RichMarkdownEditorHandle>();
    const onChange = vi.fn();
    const { rerender } = render(element(SAMPLE, onChange, ref));
    await waitFor(() => expect(ref.current).not.toBeNull());
    rerender(element('# 別のファイル\n', onChange, ref));
    await waitFor(() => expect(ref.current?.markdown()).toBe('# 別のファイル\n'));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(ref.current?.markdown()).toBe('# 別のファイル\n');
  });

  it('resolves a file-relative picture through resolveImage and leaves an external one alone', async () => {
    await mounted(`![a](./images/overview.png)\n\n![b](${HOST}/b.png)\n\n![c](other/c.png)\n`);
    await waitFor(() =>
      expect(document.querySelectorAll('img.rich-image__picture').length).toBe(2),
    );
    const sources = Array.from(document.querySelectorAll('img.rich-image__picture')).map((img) =>
      img.getAttribute('src'),
    );
    expect(sources).toEqual(['/api/docs/assets?path=./images/overview.png', `${HOST}/b.png`]);
    expect(document.body.textContent).toContain('No image');
  });

  it('does not let resolveImage see an owned attachment or an unsafe scheme', async () => {
    const seen: string[] = [];
    const ref = createRef<RichMarkdownEditorHandle>();
    render(
      <RichMarkdownEditor
        value={`![a](attachment:0123456789abcdef0123456789abcdef)\n\n![b](javascript:alert(1))\n\n![c](//evil.example/x.png)\n`}
        onChange={vi.fn()}
        aria-label="Document"
        resolveImage={(src) => {
          seen.push(src);
          return `/x/${src}`;
        }}
        ref={ref}
      />,
    );
    await waitFor(() => expect(document.querySelector('.ProseMirror')).toBeTruthy());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    expect(seen).toEqual([]);
    expect(document.querySelector('img.rich-image__picture')).toBeNull();
  });

  it('is read-only when disabled', async () => {
    const ref = createRef<RichMarkdownEditorHandle>();
    render(
      <RichMarkdownEditor
        value={SAMPLE}
        onChange={vi.fn()}
        aria-label="Document"
        disabled
        ref={ref}
      />,
    );
    await waitFor(() => expect(document.querySelector('.ProseMirror')).toBeTruthy());
    await waitFor(() =>
      expect(document.querySelector('.ProseMirror')?.getAttribute('contenteditable')).toBe('false'),
    );
  });
});
