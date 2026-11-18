import { describe, expect, it } from 'vitest';
import { keyboardInset, watchKeyboardInset } from './keyboardInset';

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
});

describe('watchKeyboardInset', () => {
  it('publishes the visual viewport and follows its scroll', () => {
    const viewport = Object.assign(new EventTarget(), { height: 500, offsetTop: 0 });
    const target = Object.assign(new EventTarget(), {
      visualViewport: viewport,
      document,
    }) as unknown as Window;
    Object.defineProperty(document.documentElement, 'clientHeight', {
      value: 800,
      configurable: true,
    });
    const stop = watchKeyboardInset(target);
    const root = document.documentElement;
    expect(root.style.getPropertyValue('--keyboard-inset')).toBe('300px');
    expect(root.style.getPropertyValue('--visual-top')).toBe('0px');
    expect(root.hasAttribute('data-visual-keyboard')).toBe(true);
    viewport.offsetTop = 40;
    target.dispatchEvent(new Event('scroll'));
    expect(root.style.getPropertyValue('--visual-top')).toBe('40px');
    expect(root.style.getPropertyValue('--keyboard-inset')).toBe('260px');
    stop();
    expect(root.style.getPropertyValue('--visual-top')).toBe('');
    expect(root.hasAttribute('data-visual-keyboard')).toBe(false);
  });
});
