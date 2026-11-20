import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import '../../../shared/i18n';
import type { TaskResult } from '../../../shared/api/contracts';
import { ResultsView } from './ResultsView';

function renderWithLink(link: string) {
  const result: TaskResult = {
    version: 1,
    key: 'k',
    kind: 'final',
    title: 'Done',
    summary: 'done',
    link,
    at: '2026-11-20T05:10:00Z',
  };
  render(<ResultsView state={{ status: 'ready', results: [result] }} attachmentUrl={() => ''} />);
}

describe('ResultsView link', () => {
  it('opens an https URL in a new tab', () => {
    const pull = ['https:', '', 'github.com/FooQoo/agent-board/pull/1'].join('/');
    renderWithLink(pull);
    const anchor = screen.getByRole('link');
    expect(anchor.getAttribute('href')).toBe(pull);
    expect(anchor.getAttribute('target')).toBe('_blank');
    expect(anchor.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it.each([
    'outputs/report.html',
    'file:///tmp/a.html',
    'javascript:alert(1)',
    'data:text/plain,x',
  ])('keeps %s as text', (link) => {
    renderWithLink(link);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText(link).tagName).toBe('SPAN');
  });
});

describe('ResultsView title', () => {
  it('shows the title as the heading of each result', () => {
    const results: TaskResult[] = [
      {
        version: 1,
        key: 'a',
        kind: 'progress',
        title: 'First look',
        summary: 'S1',
        at: '2026-11-20T05:10:00Z',
      },
      {
        version: 2,
        key: 'b',
        kind: 'final',
        title: 'Finished',
        summary: 'S2',
        at: '2026-11-20T06:10:00Z',
      },
    ];
    render(<ResultsView state={{ status: 'ready', results }} attachmentUrl={() => ''} />);
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(['Finished', 'First look']);
  });
});
