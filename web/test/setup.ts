import { cleanup } from '@testing-library/react';
import { afterEach, beforeAll } from 'vitest';

if (typeof window.matchMedia === 'undefined') {
  window.matchMedia = (media) => ({
    media,
    matches: false,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  });
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// jsdom has no layout: every observed element counts as visible, once, after it is observed.
if (typeof globalThis.IntersectionObserver === 'undefined') {
  globalThis.IntersectionObserver = class StubIntersectionObserver {
    private readonly callback: IntersectionObserverCallback;
    constructor(callback: IntersectionObserverCallback) {
      this.callback = callback;
    }
    observe(target: Element) {
      const entry = { target, isIntersecting: true, intersectionRatio: 1 };
      setTimeout(() => {
        this.callback(
          [entry as unknown as IntersectionObserverEntry],
          this as unknown as IntersectionObserver,
        );
      }, 0);
    }
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  } as unknown as typeof globalThis.IntersectionObserver;
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

// Code that the pages load after their first screen is fetched before each file's tests, so a
// dialog opens in the same render as it would once the page has settled.
beforeAll(async () => {
  const [
    { actionDialog, bulkArchiveDialog },
    { settingsDialog },
    { preloadMonitorDrawer },
    markdown,
  ] = await Promise.all([
    import('../src/app/dialogs/lazyDialogs'),
    import('../src/features/settings/ui/settingsSlot'),
    import('../src/pages/monitor/View'),
    import('../src/shared/markdown/LazyMarkdownSections'),
  ]);
  await Promise.all([
    actionDialog.preload(),
    bulkArchiveDialog.preload(),
    settingsDialog.preload(),
    preloadMonitorDrawer(),
    markdown.preloadMarkdownSections(),
  ]);
});
