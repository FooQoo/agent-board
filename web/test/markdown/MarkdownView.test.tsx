import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MarkdownView } from '../../src/components/markdown/MarkdownView';
import { selectLocale } from '../../src/i18n';

beforeEach(() => selectLocale('en'));
afterEach(cleanup);

function view(source: string) {
  return render(<MarkdownView source={source} />);
}

describe('MarkdownView', () => {
  it('renders headings, paragraphs, quotes, code and strikethrough', () => {
    const { container } = view(
      '# H1\n\n### H3\n\nParagraph with ~~gone~~ and `code`.\n\n> quoted\n\n```\nlong code\n```\n',
    );
    expect(screen.getByRole('heading', { level: 1, name: 'H1' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: 'H3' })).toBeTruthy();
    expect(container.querySelector('del')?.textContent).toBe('gone');
    expect(container.querySelector('blockquote')?.textContent).toContain('quoted');
    expect(container.querySelector('pre code')?.textContent).toBe('long code\n');
  });

  it('renders lists and ordered lists', () => {
    const { container } = view('- a\n- b\n\n1. one\n2. two\n');
    expect(container.querySelectorAll('ul > li')).toHaveLength(2);
    expect(container.querySelectorAll('ol > li')).toHaveLength(2);
  });

  it('renders a checklist that cannot be operated', () => {
    view('- [x] done\n- [ ] todo\n');
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes).toHaveLength(2);
    expect(boxes.map((box) => box.checked)).toEqual([true, false]);
    for (const box of boxes) {
      expect(box.disabled).toBe(true);
      box.focus();
      expect(document.activeElement).not.toBe(box);
      fireEvent.click(box);
    }
    expect((screen.getAllByRole('checkbox') as HTMLInputElement[]).map((b) => b.checked)).toEqual([
      true,
      false,
    ]);
  });

  it('renders a table inside a horizontal scroll container', () => {
    const { container } = view('| a | b |\n|---|---|\n| 1 | 2 |\n');
    const table = container.querySelector('table');
    expect(table).toBeTruthy();
    expect(table?.parentElement?.classList.contains('md-scroll')).toBe(true);
    expect(container.querySelectorAll('td')).toHaveLength(2);
  });

  it('keeps a single newline as a line break', () => {
    const { container } = view('line one\nline two');
    expect(container.querySelectorAll('p br')).toHaveLength(1);
  });

  it('shows raw HTML as text and never creates its elements', () => {
    const { container } = view(
      'before <script>alert(1)</script> <img src="x" onerror="alert(2)"> after\n\n<div onclick="x()">block</div>',
    );
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('div[onclick]')).toBeNull();
    expect(container.textContent).toContain('<script>alert(1)</script>');
    expect(container.textContent).toContain('<img src="x" onerror="alert(2)">');
    expect(container.textContent).toContain('<div onclick="x()">block</div>');
  });

  it('opens an allowed link in a new tab without sending the referrer', () => {
    view('[site](https://example.com/a) and <https://example.org/b>');
    const link = screen.getByRole('link', { name: 'site' });
    expect(link.getAttribute('href')).toBe('https://example.com/a');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(screen.getAllByRole('link')).toHaveLength(2);
  });

  it('shows a link that is not http(s) as text', () => {
    const { container } = view(
      '[a](javascript:alert(1)) [b](data:text/html,x) [c](file:///etc/passwd) [d](/relative) [e](mailto:x@y.z) [f](//host/x)',
    );
    expect(container.querySelector('a')).toBeNull();
    for (const label of ['a', 'b', 'c', 'd', 'e', 'f']) {
      expect(container.textContent).toContain(label);
    }
  });

  it('shows an allowed image with no referrer and lazy loading', () => {
    const { container } = view('![alt text](https://example.com/p.png)');
    const img = container.querySelector('img');
    expect(img?.getAttribute('src')).toBe('https://example.com/p.png');
    expect(img?.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(img?.getAttribute('loading')).toBe('lazy');
    expect(img?.getAttribute('alt')).toBe('alt text');
    expect(screen.queryByText('No image')).toBeNull();
  });

  it('replaces an image that fails to load with the placeholder', () => {
    const { container } = view('![broken](https://example.com/missing.png)');
    fireEvent.error(container.querySelector('img') as HTMLImageElement);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('No image')).toBeTruthy();
  });

  it('does not fetch images of other kinds and shows the placeholder', () => {
    const { container } = view(
      '![a](data:image/png;base64,AAAA) ![b](file:///x.png) ![c](rel/x.png) ![d](javascript:x) ![e]()',
    );
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getAllByText('No image')).toHaveLength(5);
  });

  it('translates the placeholder label', () => {
    selectLocale('ja');
    view('![a](rel.png)');
    expect(screen.getByText('No image')).toBeTruthy();
  });
});
