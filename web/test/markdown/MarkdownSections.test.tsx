import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MarkdownSections } from '../../src/components/markdown/MarkdownSections';
import { selectLocale } from '../../src/i18n';

beforeEach(() => selectLocale('en'));
afterEach(cleanup);

const SOURCE = 'Intro text\n\n## Goals\n\nGoal body\n\n## Steps\n\n1. one\n2. two\n3. three\n';

function toggle(name: RegExp) {
  return screen.getByRole('button', { name });
}

describe('MarkdownSections', () => {
  it('shows the preamble and every section open at first, with counts', () => {
    render(<MarkdownSections source={SOURCE} />);
    expect(screen.getByText('Intro text')).toBeTruthy();
    expect(screen.getByText('Goal body')).toBeTruthy();
    expect(screen.getByText('three')).toBeTruthy();
    expect(toggle(/Goals/).getAttribute('aria-expanded')).toBe('true');
    expect(toggle(/Goals/).textContent).toContain('1');
    expect(toggle(/Steps/).textContent).toContain('3');
  });

  it('closes and opens a section by hand and keeps the preamble', () => {
    render(<MarkdownSections source={SOURCE} />);
    fireEvent.click(toggle(/Goals/));
    expect(screen.queryByText('Goal body')).toBeNull();
    expect(toggle(/Goals/).getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByText('three')).toBeTruthy();
    expect(screen.getByText('Intro text')).toBeTruthy();
    fireEvent.click(toggle(/Goals/));
    expect(screen.getByText('Goal body')).toBeTruthy();
  });

  it('opens everything again when the key changes', () => {
    const { rerender } = render(<MarkdownSections key="card-1" source={SOURCE} />);
    fireEvent.click(toggle(/Goals/));
    fireEvent.click(toggle(/Steps/));
    expect(screen.queryByText('Goal body')).toBeNull();
    rerender(<MarkdownSections key="card-2" source={SOURCE} />);
    expect(screen.getByText('Goal body')).toBeTruthy();
    expect(screen.getByText('three')).toBeTruthy();
  });

  it('keeps the open state when the same card gets a new description', () => {
    const { rerender } = render(<MarkdownSections key="card-1" source={SOURCE} />);
    fireEvent.click(toggle(/Goals/));
    rerender(<MarkdownSections key="card-1" source={`${SOURCE}\nmore`} />);
    expect(screen.queryByText('Goal body')).toBeNull();
  });

  it('shows the whole text without folding when there is no H2', () => {
    render(<MarkdownSections source={'# Title\n\nJust text\n\n### Sub\n\n- a\n'} />);
    expect(screen.getByText('Just text')).toBeTruthy();
    expect(screen.getByText('Sub')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('does not fold H3 under its section', () => {
    render(<MarkdownSections source={'## A\n\n### A1\n\ntext\n'} />);
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 3, name: 'A1' })).toBeTruthy();
  });

  it('does not offer to open or close everything', () => {
    render(<MarkdownSections source={SOURCE} />);
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });

  it('shows the empty message for a blank description', () => {
    render(<MarkdownSections source={'  \n'} />);
    expect(screen.getByText('No description.')).toBeTruthy();
    selectLocale('ja');
    cleanup();
    render(<MarkdownSections source="" />);
    expect(screen.getByText('説明はありません。')).toBeTruthy();
  });

  it('sets the title of a section from its plain text and does not split code', () => {
    render(<MarkdownSections source={'## Real\n\n```\n## Fake\n```\n'} />);
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByText('## Fake', { exact: false })).toBeTruthy();
  });
});
