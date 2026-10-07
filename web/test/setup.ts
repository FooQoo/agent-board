import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// jsdom has no layout, but CodeMirror measures text through Range rectangles.
const emptyRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] });
if (typeof Range.prototype.getClientRects !== 'function') {
  Range.prototype.getClientRects = emptyRects as unknown as Range['getClientRects'];
}
if (typeof Range.prototype.getBoundingClientRect !== 'function') {
  Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);
}

afterEach(() => {
  cleanup();
});
