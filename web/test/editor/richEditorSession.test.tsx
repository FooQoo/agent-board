import { act, cleanup, render, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RichMarkdownEditor,
  type RichMarkdownEditorHandle,
} from '../../src/shared/rich-editor/RichMarkdownEditor';
import { selectLocale } from '../../src/shared/i18n';

const { draw, initialize } = vi.hoisted(() => ({ draw: vi.fn(), initialize: vi.fn() }));

vi.mock('mermaid', () => ({ default: { initialize, render: draw } }));

const TEXT = '## One\n\nBody text.\n\n## Two\n\nMore.\n';

beforeEach(() => {
  selectLocale('en');
  draw.mockReset();
  draw.mockImplementation(async (id: string) => ({ svg: `<svg id="${id}"></svg>` }));
});

afterEach(() => {
  cleanup();
  document.documentElement.style.removeProperty('--r-accent');
});

const prose = () => document.querySelector<HTMLElement>('.ProseMirror');

describe('the editor session', () => {
  it('applies a command given before the editor is ready, once it is', async () => {
    const onChange = vi.fn();
    let seen: RichMarkdownEditorHandle | null = null;
    render(
      <RichMarkdownEditor
        value={TEXT}
        onChange={onChange}
        aria-label="Description"
        ref={(handle) => {
          if (handle !== null && seen === null) {
            seen = handle;
            handle.insert('Early ');
          }
        }}
      />,
    );
    await waitFor(() => expect(onChange).toHaveBeenCalled(), { timeout: 5000 });
    expect(onChange.mock.calls.at(-1)?.[0]).toContain('Early');
  });

  it('replaces the editor when the value changes from outside, and destroys the old one', async () => {
    const ref = createRef<RichMarkdownEditorHandle>();
    const onChange = vi.fn();
    const element = (value: string) => (
      <RichMarkdownEditor value={value} onChange={onChange} aria-label="Description" ref={ref} />
    );
    const { rerender } = render(element(TEXT));
    await waitFor(() => expect(prose()).toBeTruthy());
    const old = prose();
    rerender(element('## Fresh\n'));
    await waitFor(() => expect(prose()?.textContent).toContain('Fresh'));
    expect(document.querySelectorAll('.ProseMirror')).toHaveLength(1);
    expect(prose()).not.toBe(old);
    expect(old?.isConnected).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('makes the document read-only while disabled, and writable again after', async () => {
    const element = (disabled: boolean) => (
      <RichMarkdownEditor
        value={TEXT}
        onChange={vi.fn()}
        aria-label="Description"
        disabled={disabled}
      />
    );
    const { rerender } = render(element(true));
    await waitFor(() => expect(prose()?.getAttribute('contenteditable')).toBe('false'));
    expect(prose()?.getAttribute('aria-label')).toBe('Description');
    rerender(element(false));
    await waitFor(() => expect(prose()?.getAttribute('contenteditable')).toBe('true'));
  });

  it('draws no diagram and reports nothing after it is unmounted', async () => {
    const onChange = vi.fn();
    const body = '## D\n\n```mermaid\nflowchart TD\n  A --> B\n```\n';
    const { unmount } = render(
      <RichMarkdownEditor value={body} onChange={onChange} aria-label="Description" />,
    );
    await waitFor(() => expect(draw).toHaveBeenCalled());
    unmount();
    const drawn = draw.mock.calls.length;
    await act(async () => {
      document.documentElement.style.setProperty('--r-accent', '#123456');
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(draw.mock.calls.length).toBe(drawn);
    expect(document.querySelector('.ProseMirror')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('can be unmounted before it is ready without a failure', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { unmount } = render(
      <RichMarkdownEditor value={TEXT} onChange={vi.fn()} aria-label="Description" />,
    );
    unmount();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});
