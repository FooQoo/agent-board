import { fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResizeHandle } from '../../src/shared/ui/resize-handle/ResizeHandle';
import { selectLocale } from '../../src/shared/i18n';

function setup() {
  const props = { startDrag: vi.fn(), moveDrag: vi.fn(), endDrag: vi.fn() };
  render(<ResizeHandle {...props} />);
  return props;
}

describe('ResizeHandle', () => {
  afterEach(() => {
    selectLocale('en');
    window.localStorage.clear();
  });

  it('is a labelled vertical separator in English and Japanese', async () => {
    selectLocale('en');
    setup();
    const el = screen.getByRole('separator', { name: 'Resize task details' });
    expect(el.getAttribute('aria-orientation')).toBe('vertical');
    expect(el.hasAttribute('tabindex')).toBe(false);
    selectLocale('ja');
    expect(await screen.findByRole('separator', { name: 'タスクの詳細の幅を変更' })).toBeTruthy();
    selectLocale('en');
  });

  it('forwards pointer gestures', async () => {
    selectLocale('en');
    const props = setup();
    const el = screen.getByRole('separator');
    fireEvent.pointerDown(el, { clientX: 100, button: 0, pointerType: 'mouse', pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: 80, pointerId: 1 });
    fireEvent.pointerUp(el, { pointerId: 1 });
    expect(props.startDrag).toHaveBeenCalledWith(100);
    expect(props.moveDrag).toHaveBeenCalledWith(80);
    expect(props.endDrag).toHaveBeenCalledTimes(1);
  });

  it('ignores non-primary mouse buttons and handles touch', () => {
    const props = setup();
    const el = screen.getByRole('separator');
    fireEvent.pointerDown(el, { clientX: 1, button: 2, pointerType: 'mouse', pointerId: 1 });
    expect(props.startDrag).not.toHaveBeenCalled();
    fireEvent.pointerDown(el, { clientX: 7, button: 0, pointerType: 'touch', pointerId: 2 });
    expect(props.startDrag).toHaveBeenCalledWith(7);
  });

  it('keeps resize.css free of hex colours', () => {
    const css = readFileSync(
      join(import.meta.dirname, '../../src/shared/styles/resize.css'),
      'utf8',
    );
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
