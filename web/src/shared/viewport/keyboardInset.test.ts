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
});

describe('keyboardOpen', () => {
  it('is open while the visual viewport ends above the layout bottom', () => {
    expect(keyboardOpen(800, { height: 500, offsetTop: 0 })).toBe(true);
  });

  it('stays open when the page is panned up to a low field (the answer note)', () => {
    // The inset is 0 here, yet the keyboard still covers 300px.
    expect(keyboardInset(800, { height: 500, offsetTop: 300 })).toBe(0);
    expect(keyboardOpen(800, { height: 500, offsetTop: 300 })).toBe(true);
  });

  it('is closed at full height, and a pinch zoom is not a keyboard', () => {
    expect(keyboardOpen(800, { height: 800, offsetTop: 0 })).toBe(false);
    expect(keyboardOpen(800, { height: 400, offsetTop: 400, scale: 2 })).toBe(false);
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
    const field = document.body.appendChild(document.createElement('input'));
    field.focus();
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
    field.remove();
  });

  it('marks the keyboard while the page is panned to a focused field', () => {
    const viewport = Object.assign(new EventTarget(), { height: 500, offsetTop: 300 });
    const target = Object.assign(new EventTarget(), {
      visualViewport: viewport,
      document,
    }) as unknown as Window;
    Object.defineProperty(document.documentElement, 'clientHeight', {
      value: 800,
      configurable: true,
    });
    const field = document.body.appendChild(document.createElement('textarea'));
    field.focus();
    const stop = watchKeyboardInset(target);
    expect(document.documentElement.hasAttribute('data-visual-keyboard')).toBe(true);
    stop();
    field.remove();
  });

  it('marks no keyboard while no text field has the focus', () => {
    // A pinch zoom or a toolbar also makes the visual viewport smaller; dialogs must stay centered.
    const viewport = Object.assign(new EventTarget(), { height: 500, offsetTop: 0 });
    const target = Object.assign(new EventTarget(), {
      visualViewport: viewport,
      document,
    }) as unknown as Window;
    Object.defineProperty(document.documentElement, 'clientHeight', {
      value: 800,
      configurable: true,
    });
    const field = document.body.appendChild(document.createElement('input'));
    const stop = watchKeyboardInset(target);
    const root = document.documentElement;
    expect(root.hasAttribute('data-visual-keyboard')).toBe(false);
    field.focus();
    expect(root.hasAttribute('data-visual-keyboard')).toBe(true);
    field.blur();
    expect(root.hasAttribute('data-visual-keyboard')).toBe(false);
    stop();
    field.remove();
  });

  it('marks a text focus on a touch screen even when the viewport does not shrink', () => {
    const viewport = Object.assign(new EventTarget(), { height: 800, offsetTop: 0 });
    const target = Object.assign(new EventTarget(), {
      visualViewport: viewport,
      document,
      matchMedia: () => ({ matches: true }),
    }) as unknown as Window;
    Object.defineProperty(document.documentElement, 'clientHeight', {
      value: 800,
      configurable: true,
    });
    const field = document.body.appendChild(document.createElement('textarea'));
    const stop = watchKeyboardInset(target);
    const root = document.documentElement;
    expect(root.hasAttribute('data-text-focus')).toBe(false);
    field.focus();
    expect(root.hasAttribute('data-text-focus')).toBe(true);
    expect(root.hasAttribute('data-visual-keyboard')).toBe(false);
    field.blur();
    expect(root.hasAttribute('data-text-focus')).toBe(false);
    stop();
    field.remove();
  });

  it('keeps the text focus mark until a press that blurred the field ends', async () => {
    const viewport = Object.assign(new EventTarget(), { height: 800, offsetTop: 0 });
    const target = Object.assign(new EventTarget(), {
      visualViewport: viewport,
      document,
      matchMedia: () => ({ matches: true }),
      setTimeout: (fn: () => void) => setTimeout(fn, 0),
    }) as unknown as Window;
    Object.defineProperty(document.documentElement, 'clientHeight', {
      value: 800,
      configurable: true,
    });
    const field = document.body.appendChild(document.createElement('textarea'));
    const stop = watchKeyboardInset(target);
    const root = document.documentElement;
    field.focus();
    document.dispatchEvent(new Event('pointerdown'));
    field.blur();
    // The layout must not move from under the finger before the tap completes.
    expect(root.hasAttribute('data-text-focus')).toBe(true);
    document.dispatchEvent(new Event('pointerup'));
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(root.hasAttribute('data-text-focus')).toBe(false);
    stop();
    field.remove();
  });

  it('marks no text focus with a mouse', () => {
    const viewport = Object.assign(new EventTarget(), { height: 800, offsetTop: 0 });
    const target = Object.assign(new EventTarget(), {
      visualViewport: viewport,
      document,
      matchMedia: () => ({ matches: false }),
    }) as unknown as Window;
    Object.defineProperty(document.documentElement, 'clientHeight', {
      value: 800,
      configurable: true,
    });
    const field = document.body.appendChild(document.createElement('textarea'));
    const stop = watchKeyboardInset(target);
    const root = document.documentElement;
    field.focus();
    expect(root.hasAttribute('data-text-focus')).toBe(false);
    stop();
    field.remove();
  });
});
