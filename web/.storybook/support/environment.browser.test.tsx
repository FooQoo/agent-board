import { cleanup, render } from '@testing-library/react';
import { createPortal } from 'react-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { StoryEnvironment, type StoryGlobals } from './decorators';
import { assertNoUnhandledRequests, resetHandlers, useMockServer } from './msw';

const globals = (overrides: Partial<StoryGlobals> = {}): StoryGlobals => ({
  locale: 'en',
  mode: 'light',
  accent: 'blue',
  width: 'desktop',
  ...overrides,
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('story environment', () => {
  it('applies the toolbar theme and language, and restores the document when it unmounts', () => {
    const root = document.documentElement;
    const before = { mode: root.dataset.mode, accent: root.dataset.accent, lang: root.lang };
    const { unmount } = render(
      <StoryEnvironment
        globals={globals({ mode: 'dark', accent: 'red', locale: 'ja' })}
        frame="board"
      >
        <span>content</span>
      </StoryEnvironment>,
    );
    expect(root.dataset.mode).toBe('dark');
    expect(root.dataset.accent).toBe('red');
    expect(root.classList.contains('dark')).toBe(true);
    expect(root.lang).toBe('ja');
    unmount();
    expect(root.dataset.mode).toBe(before.mode);
    expect(root.dataset.accent).toBe(before.accent);
    expect(root.classList.contains('dark')).toBe(false);
    expect(root.lang).toBe(before.lang);
  });

  it('keeps the theme in memory and writes no preference to localStorage', () => {
    render(
      <StoryEnvironment
        globals={globals({ mode: 'dark', accent: 'teal', locale: 'ja' })}
        frame="board"
      >
        <span>content</span>
      </StoryEnvironment>,
    );
    const stored = Object.keys(window.localStorage).filter((key) => key.startsWith('agboard.'));
    expect(stored).toEqual([]);
  });

  it('renders the width frame at the desktop and phone widths', () => {
    const { container, unmount } = render(
      <StoryEnvironment globals={globals({ width: 'phone-390' })} frame="board">
        <span>content</span>
      </StoryEnvironment>,
    );
    const frame = container.querySelector<HTMLElement>('[data-story-width]');
    expect(frame?.dataset.storyWidth).toBe('phone-390');
    expect(frame?.style.width).toBe('390px');
    unmount();
  });

  it('applies the monitor stylesheets only in a monitor frame and removes them afterwards', () => {
    const count = () => document.querySelectorAll('style[data-story-style="monitor"]').length;
    const board = render(
      <StoryEnvironment globals={globals()} frame="board">
        <span>board</span>
      </StoryEnvironment>,
    );
    expect(count()).toBe(0);
    board.unmount();
    const monitor = render(
      <StoryEnvironment globals={globals({ width: 'phone-390' })} frame="monitor">
        <span>monitor</span>
      </StoryEnvironment>,
    );
    expect(count()).toBe(2);
    monitor.unmount();
    expect(count()).toBe(0);
  });

  it('removes a portal it rendered into the document when the Story unmounts', () => {
    const { unmount } = render(
      <StoryEnvironment globals={globals()} frame="board">
        {createPortal(<div data-testid="portal-probe">portal</div>, document.body)}
      </StoryEnvironment>,
    );
    expect(document.querySelector('[data-testid="portal-probe"]')).not.toBeNull();
    unmount();
    expect(document.querySelector('[data-testid="portal-probe"]')).toBeNull();
  });
});

describe('product requests through MSW', () => {
  afterEach(() => {
    resetHandlers();
    // Each test checks its own record; the setup file would otherwise fail on the next one.
    try {
      assertNoUnhandledRequests();
    } catch {
      // Recorded by a test that expected it.
    }
  });

  it('fails a request to the product API that no handler answers, and records it', async () => {
    await expect(fetch('/api/projects')).rejects.toThrow();
    expect(() => assertNoUnhandledRequests()).toThrow('GET');
    expect(() => assertNoUnhandledRequests()).not.toThrow();
  });

  it('answers the API and the event stream from the sample-data server', async () => {
    useMockServer();
    const response = await fetch('/api/projects', { headers: { 'X-Agboard-Token': 'mock-token' } });
    expect(response.status).toBe(200);
    const source = new EventSource('/api/events');
    await new Promise((resolve) => source.addEventListener('ready', resolve, { once: true }));
    source.close();
    expect(() => assertNoUnhandledRequests()).not.toThrow();
  });

  it('lets requests outside the product API pass', async () => {
    const response = await fetch('/sample-attachment.png');
    expect(response.status).toBe(200);
    expect(() => assertNoUnhandledRequests()).not.toThrow();
  });
});
