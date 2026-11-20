import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ResultsView } from '../../src/features/tasks/results/ResultsView';
import { selectLocale } from '../../src/shared/i18n';
import type { TaskResult } from '../../src/shared/api/contracts';

beforeEach(() => {
  selectLocale('en');
  Element.prototype.scrollIntoView = () => {};
});

const results: TaskResult[] = [
  {
    version: 1,
    key: 'a',
    kind: 'progress',
    title: 'First draft',
    summary: 'First draft body',
    at: '2026-11-20T01:00:00Z',
  },
  {
    version: 2,
    key: 'b',
    kind: 'final',
    title: 'Screen ready',
    summary: 'Screen is ready',
    attachmentId: 'img-1',
    link: 'storage/outputs/report.html',
    at: '2026-11-20T02:00:00Z',
  },
];
const url = (id: string) => `/api/projects/p/tasks/1/attachments/${id}`;

describe('ResultsView', () => {
  it('lists the newest result first with its kind, summary, image, and link text', () => {
    const { container } = render(
      <ResultsView state={{ status: 'ready', results }} attachmentUrl={url} />,
    );
    const items = container.querySelectorAll('[data-result-version]');
    expect([...items].map((item) => item.getAttribute('data-result-version'))).toEqual(['2', '1']);
    expect(screen.getByText('Final')).toBeTruthy();
    expect(screen.getByText('In progress')).toBeTruthy();
    expect(screen.getByText('Screen is ready')).toBeTruthy();
    expect(screen.getByText('storage/outputs/report.html')).toBeTruthy();
    expect(container.querySelector('img')?.getAttribute('src')).toBe(url('img-1'));
  });

  it('shows every image of a result with several, and steps through them when enlarged', () => {
    const many: TaskResult = {
      version: 3,
      key: 'c',
      kind: 'final',
      title: 'Mock',
      summary: 'Mock screens',
      attachmentIds: ['s1', 's2', 's3'],
      at: '2026-11-20T03:00:00Z',
    };
    const { container } = render(
      <ResultsView state={{ status: 'ready', results: [many] }} attachmentUrl={url} />,
    );
    expect([...container.querySelectorAll('img')].map((img) => img.getAttribute('src'))).toEqual([
      url('s1'),
      url('s2'),
      url('s3'),
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Enlarge image 2 of 3 of result 3' }));
    expect(screen.getByText('2 / 3')).toBeTruthy();
    // No arrow buttons: images are reached by swiping (scrolling) or the arrow keys.
    expect(screen.queryByRole('button', { name: /(Next|Previous) image/ })).toBeNull();
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(screen.getByText('3 / 3')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(screen.getByText('3 / 3')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'ArrowLeft' });
    expect(screen.getByText('2 / 3')).toBeTruthy();
  });

  it('follows a sideways swipe of the enlarged view and keeps each image in its own scrolling slide', () => {
    const many: TaskResult = {
      version: 3,
      key: 'c',
      kind: 'final',
      title: 'Mock',
      summary: 'Mock screens',
      attachmentIds: ['s1', 's2', 's3'],
      at: '2026-11-20T03:00:00Z',
    };
    render(<ResultsView state={{ status: 'ready', results: [many] }} attachmentUrl={url} />);
    fireEvent.click(screen.getByRole('button', { name: 'Enlarge image 1 of 3 of result 3' }));
    const viewer = document.querySelector('[data-viewer]') as HTMLElement;
    expect(viewer.querySelectorAll('.lightbox__slide')).toHaveLength(3);
    expect(screen.getByText('1 / 3')).toBeTruthy();
    Object.defineProperty(viewer, 'clientWidth', { value: 300, configurable: true });
    viewer.scrollLeft = 600;
    fireEvent.scroll(viewer);
    expect(screen.getByText('3 / 3')).toBeTruthy();
  });

  it('shows a text-only result without an image', () => {
    const { container } = render(
      <ResultsView state={{ status: 'ready', results: results.slice(0, 1) }} attachmentUrl={url} />,
    );
    expect(screen.getByText('First draft')).toBeTruthy();
    expect(container.querySelector('img')).toBeNull();
  });

  it('highlights and scrolls to the version a link points at', () => {
    let scrolled: Element | null = null;
    Element.prototype.scrollIntoView = function () {
      scrolled = this;
    };
    const { container } = render(
      <ResultsView state={{ status: 'ready', results }} attachmentUrl={url} focusVersion={1} />,
    );
    const focused = container.querySelector('[data-focused="true"]');
    expect(focused?.getAttribute('data-result-version')).toBe('1');
    expect(scrolled).toBe(focused);
  });

  it('says so when the linked version is not there', () => {
    render(
      <ResultsView state={{ status: 'ready', results }} attachmentUrl={url} focusVersion={9} />,
    );
    expect(screen.getByRole('status').textContent).toContain('Result 9 was not found');
  });

  it('enlarges the image', () => {
    render(<ResultsView state={{ status: 'ready', results }} attachmentUrl={url} />);
    fireEvent.click(screen.getByRole('button', { name: 'Enlarge the image of result 2' }));
    expect(screen.getAllByRole('img').length).toBeGreaterThan(0);
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('shows the empty, loading, and failed states', () => {
    const { rerender } = render(
      <ResultsView state={{ status: 'ready', results: [] }} attachmentUrl={url} />,
    );
    expect(screen.getByText('No results yet.')).toBeTruthy();
    rerender(<ResultsView state={{ status: 'loading' }} attachmentUrl={url} />);
    expect(screen.getByText('Loading the results…')).toBeTruthy();
    rerender(<ResultsView state={{ status: 'error' }} attachmentUrl={url} onRetry={() => {}} />);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('says the linked version is missing even when the task has no results', () => {
    render(
      <ResultsView state={{ status: 'ready', results: [] }} attachmentUrl={url} focusVersion={3} />,
    );
    expect(screen.getByText('No results yet.')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('Result 3 was not found');
  });

  it('keeps the earlier results and offers a retry when a refresh failed', () => {
    const retry = vi.fn();
    render(
      <ResultsView
        state={{ status: 'ready', results }}
        attachmentUrl={url}
        refreshFailed
        onRetry={retry}
      />,
    );
    expect(screen.getByText('Screen is ready')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalled();
  });
});
