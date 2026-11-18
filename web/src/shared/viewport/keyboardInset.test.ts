import { describe, expect, it } from 'vitest';
import { keyboardInset, keyboardOpen, watchKeyboardInset } from './keyboardInset';

describe('keyboardInset', () => {
  it('is the part of the layout viewport the keyboard covers', () => {
    expect(keyboardInset(800, { height: 500, offsetTop: 0 })).toBe(300);
  });

  it('ignores the visual viewport scrolling inside the page', () => {
    expect(keyboardInset(800, { height: 500, offsetTop: 120 })).toBe(180);
  });

  it('is 0 without a keyboard, and never negative', () => {
    expect(keyboardInset(800, { height: 800, offsetTop: 0 })).toBe(0);
    expect(keyboardInset(800, { height: 820, offsetTop: 0 })).toBe(0);
  });

  it('counts only a large inset as an open keyboard', () => {
    expect(keyboardOpen(0)).toBe(false);
    expect(keyboardOpen(60)).toBe(false);
    expect(keyboardOpen(336)).toBe(true);
  });
});

describe('watchKeyboardInset', () => {
  it('marks the root while the keyboard is open and clears it on cleanup', () => {
    const viewport = Object.assign(new EventTarget(), { height: 800, offsetTop: 0 });
    const root = document.documentElement;
    Object.defineProperty(root, 'clientHeight', { value: 800, configurable: true });
    const target = { visualViewport: viewport, document } as unknown as Window;
    const stop = watchKeyboardInset(target);
    expect(root.hasAttribute('data-keyboard-open')).toBe(false);
    viewport.height = 464;
    viewport.dispatchEvent(new Event('resize'));
    expect(root.hasAttribute('data-keyboard-open')).toBe(true);
    expect(root.style.getPropertyValue('--keyboard-inset')).toBe('336px');
    stop();
    expect(root.hasAttribute('data-keyboard-open')).toBe(false);
    expect(root.style.getPropertyValue('--keyboard-inset')).toBe('');
  });
});
