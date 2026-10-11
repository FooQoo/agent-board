import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MarkdownView } from '../../src/components/markdown/MarkdownView';
import { selectLocale } from '../../src/i18n';

vi.mock('mermaid', () => ({
  default: {
    initialize: () => {},
    render: async (id: string, source: string) => {
      if (source.includes('BROKEN')) {
        throw new Error('Parse error on line 2:\nBROKEN');
      }
      return { svg: `<svg id="${id}"></svg>` };
    },
  },
}));

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

it('resolves only current-card attachment references and preserves missing-image text after removal', () => {
  const id = '0123456789abcdef0123456789abcdef';
  const source = `![capture](attachment:${id})`;
  const { rerender } = render(
    <MarkdownView
      source={source}
      resolveAttachment={(key) => (key === id ? 'blob:owned-image' : null)}
    />,
  );
  expect(screen.getByRole('img', { name: 'capture' }).getAttribute('src')).toBe('blob:owned-image');
  rerender(<MarkdownView source={source} resolveAttachment={() => null} />);
  expect(screen.queryByRole('img')).toBeNull();
  expect(screen.getByText('No image')).toBeTruthy();
  expect(screen.getByText('capture')).toBeTruthy();
});

describe('MarkdownView diagrams and captures', () => {
  const ID_A = '0123456789abcdef0123456789abcdef';
  const ID_B = 'fedcba9876543210fedcba9876543210';

  it('shows a mermaid block as a diagram instead of code, and does not show it as a code block', async () => {
    const { container } = view('```mermaid\nflowchart TD\n  A --> B\n```\n');
    expect(await screen.findByRole('button', { name: 'Enlarge diagram' })).toBeTruthy();
    expect(container.querySelector('svg')).toBeTruthy();
    expect(container.querySelector('pre')).toBeNull();
  });

  it('shows the one-line error and the notation for a broken mermaid block', async () => {
    const { container } = view('```mermaid\nflowchart TD\n  BROKEN\n```\n');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Parse error on line 2:');
    expect(container.querySelector('svg')).toBeNull();
    expect(container.textContent).toContain('BROKEN');
  });

  it('opens a diagram in one enlarged view and closes it', async () => {
    view('```mermaid\nflowchart TD\n  X --> Y\n```\n');
    fireEvent.click(await screen.findByRole('button', { name: 'Enlarge diagram' }));
    const dialogs = screen.getAllByRole('dialog');
    expect(dialogs).toHaveLength(1);
    expect(dialogs[0]?.querySelector('svg')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('keeps two consecutive images side by side and opens each one when pressed', () => {
    const { container } = view(
      `![one](https://example.com/one.png)\n![two](https://example.com/two.png)\n`,
    );
    const row = container.querySelector('.md-captures');
    expect(row?.querySelectorAll('img')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Enlarge one' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog.querySelector('img')?.getAttribute('src')).toBe('https://example.com/one.png');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  it('does not put a lone image in a row', () => {
    const { container } = view('![only](https://example.com/only.png)');
    expect(container.querySelector('.md-captures')).toBeNull();
  });

  it('keeps an image without a title and an image with a title, with the alt text unchanged', () => {
    const resolve = (id: string) => `blob:${id}`;
    render(
      <MarkdownView
        source={`![図](attachment:${ID_A})\n\n![図: a](attachment:${ID_B} "title")\n`}
        resolveAttachment={resolve}
      />,
    );
    const images = screen.getAllByRole('img') as HTMLImageElement[];
    expect(images.map((img) => img.getAttribute('alt'))).toEqual(['図', '図: a']);
    expect(images.map((img) => img.getAttribute('src'))).toEqual([`blob:${ID_A}`, `blob:${ID_B}`]);
  });

  it('resolves an assets path through the resolver and shows No image when it cannot', () => {
    const resolve = vi.fn((id: string) => (id === ID_A ? 'blob:owned' : null));
    const { rerender } = render(
      <MarkdownView
        source={`![owned](assets/${ID_A}.png)\n\n![other](assets/${ID_B}.png)\n`}
        resolveAttachment={resolve}
      />,
    );
    expect(resolve).toHaveBeenCalledWith(ID_A);
    expect(screen.getByRole('img', { name: 'owned' }).getAttribute('src')).toBe('blob:owned');
    expect(screen.getByText('No image')).toBeTruthy();
    rerender(<MarkdownView source={`![x](assets/${ID_A}.png)`} />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('No image')).toBeTruthy();
  });

  it('shows No image for an assets path that is not an owned attachment name', () => {
    const resolve = vi.fn(() => 'blob:never');
    render(<MarkdownView source="![bad](assets/../../secret.png)" resolveAttachment={resolve} />);
    expect(resolve).not.toHaveBeenCalled();
    expect(screen.getAllByText('No image').length).toBeGreaterThan(0);
  });
});
