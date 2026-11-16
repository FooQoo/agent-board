import { describe, expect, it } from 'vitest';
import {
  editingText,
  nextStableHeight,
  watchStableHeight,
} from '../../src/shared/viewport/stableHeight';

describe('the kept page height', () => {
  const tall = { width: 1024, height: 1300 };
  const keyboard = { width: 1024, height: 700 };

  it('keeps the height while the keyboard of a text field is open', () => {
    expect(nextStableHeight(tall, keyboard, true)).toBe(tall);
  });

  it('follows a shrink with no text field focused, a growth, and a rotation', () => {
    expect(nextStableHeight(tall, keyboard, false)).toBe(keyboard);
    const back = { width: 1024, height: 1310 };
    expect(nextStableHeight(tall, back, true)).toBe(back);
    const turned = { width: 1366, height: 600 };
    expect(nextStableHeight(tall, turned, true)).toBe(turned);
    expect(nextStableHeight(null, keyboard, true)).toBe(keyboard);
  });

  it('counts only fields that open a keyboard as typing', () => {
    const input = document.createElement('input');
    expect(editingText(input)).toBe(true);
    input.type = 'checkbox';
    expect(editingText(input)).toBe(false);
    const area = document.createElement('textarea');
    expect(editingText(area)).toBe(true);
    area.readOnly = true;
    expect(editingText(area)).toBe(false);
    expect(editingText(document.createElement('button'))).toBe(false);
    expect(editingText(null)).toBe(false);
  });

  it('marks the page while the keyboard covers the kept height', () => {
    const root = document.documentElement;
    const field = document.createElement('input');
    document.body.append(field);
    const resize = (height: number) => {
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
      window.dispatchEvent(new Event('resize'));
    };
    resize(1300);
    const stop = watchStableHeight(window);
    try {
      expect(root.hasAttribute('data-keyboard')).toBe(false);
      field.focus();
      resize(700);
      expect(root.style.getPropertyValue('--stable-vh')).toBe('1300px');
      expect(root.hasAttribute('data-keyboard')).toBe(true);
      resize(1300);
      expect(root.hasAttribute('data-keyboard')).toBe(false);
    } finally {
      stop();
      field.remove();
    }
  });
});
