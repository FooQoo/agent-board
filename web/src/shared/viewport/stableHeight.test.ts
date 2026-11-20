import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextStableHeight, watchStableHeight } from './stableHeight';

describe('nextStableHeight', () => {
  it('keeps the height while typing shrinks the viewport', () => {
    const kept = { width: 1000, height: 800 };
    expect(nextStableHeight(kept, { width: 1000, height: 500 }, true)).toBe(kept);
    expect(nextStableHeight(kept, { width: 1000, height: 500 }, false)).toEqual({
      width: 1000,
      height: 500,
    });
  });
});

describe('watchStableHeight', () => {
  const root = document.documentElement;
  afterEach(() => {
    root.removeAttribute('data-keyboard');
    document.body.replaceChildren();
  });

  it('marks the keyboard only while a text field has the focus', () => {
    const target = Object.assign(new EventTarget(), {
      document,
      innerWidth: 1000,
      innerHeight: 800,
    }) as unknown as Window & { innerHeight: number };
    const field = document.body.appendChild(document.createElement('input'));
    const stop = watchStableHeight(target);
    field.focus();
    target.innerHeight = 500;
    target.dispatchEvent(new Event('resize'));
    expect(root.hasAttribute('data-keyboard')).toBe(true);
    expect(root.style.getPropertyValue('--stable-vh')).toBe('800px');
    // The focus leaves before the keyboard has finished closing: dialogs are centered again at once.
    field.blur();
    expect(root.hasAttribute('data-keyboard')).toBe(false);
    stop();
  });

  it('puts a scrolled page back at the top unless the keyboard is open', () => {
    const scrollTo = vi.fn();
    const target = Object.assign(new EventTarget(), {
      document,
      innerWidth: 390,
      innerHeight: 844,
      scrollX: 0,
      scrollY: 40,
      scrollTo,
    }) as unknown as Window;
    const stop = watchStableHeight(target);
    target.dispatchEvent(new Event('scroll'));
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
    scrollTo.mockClear();
    root.setAttribute('data-visual-keyboard', '');
    target.dispatchEvent(new Event('scroll'));
    expect(scrollTo).not.toHaveBeenCalled();
    root.removeAttribute('data-visual-keyboard');
    stop();
  });
});
