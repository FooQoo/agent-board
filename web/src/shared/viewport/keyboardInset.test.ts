import { describe, expect, it } from 'vitest';
import { keyboardInset } from './keyboardInset';

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
