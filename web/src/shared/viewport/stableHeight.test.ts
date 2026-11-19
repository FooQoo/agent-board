import { afterEach, describe, expect, it } from 'vitest';
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
});
