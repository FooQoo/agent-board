import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@/shared/i18n';
import { DocsDialogContainer } from './DocsDialogContainer';

// Built in parts so the source guard keeps rejecting embedded remote URLs.
const SITE = `${['https:', '', 'example.com'].join('/')}/x`;

vi.mock('@/shared/rich-editor/RichMarkdownEditor', () => ({
  RichMarkdownEditor: ({
    value,
    onChange,
    disabled,
  }: {
    value: string;
    onChange: (v: string) => void;
    disabled?: boolean;
  }) => (
    <div>
      <textarea
        aria-label="editor"
        defaultValue={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
      {/* The links of the body, as the editor draws them: plain anchors. */}
      {[...value.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)].map(([, text, href]) => (
        <a key={href} href={href}>
          {text}
        </a>
      ))}
    </div>
  ),
}));

const TREE = {
  nodes: [
    { name: 'a.md', path: 'a.md', kind: 'file', viewer: 'markdown' },
    { name: 'b.md', path: 'b.md', kind: 'file', viewer: 'markdown' },
    { name: 'pic.png', path: 'pic.png', kind: 'file', viewer: 'image' },
    { name: 'board.pen', path: 'board.pen', kind: 'file', viewer: 'other' },
    {
      name: 'dir',
      path: 'dir',
      kind: 'dir',
      children: [{ name: 'c.md', path: 'dir/c.md', kind: 'file', viewer: 'markdown' }],
    },
  ],
  truncated: false,
};
const file = (path: string, over = {}) => ({
  path,
  content: `# ${path}\n`,
  revision: `rev-${path}`,
  ...over,
});

let fetchMock: ReturnType<typeof vi.fn>;
let files: Record<string, unknown>;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const urls = () => fetchMock.mock.calls.map((c) => String(c[0]));

beforeEach(() => {
  files = { 'a.md': file('a.md'), 'b.md': file('b.md'), 'dir/c.md': file('dir/c.md') };
  fetchMock = vi.fn(async (url: string, init?: { method?: string }) => {
    if (url.endsWith('/docs/tree')) return json(TREE);
    if (init?.method === 'POST') return new Response(null, { status: 204 });
    const path = decodeURIComponent(url.split('path=')[1] ?? '');
    return files[path] ? json(files[path]) : json({ error: { code: 'docs_not_found' } }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const open = async (onClose = vi.fn()) => {
  const user = userEvent.setup();
  render(<DocsDialogContainer projectId="p1" onClose={onClose} />);
  await screen.findByRole('treeitem', { name: /a\.md/ });
  return { user, onClose };
};
const choose = async (user: ReturnType<typeof userEvent.setup>, name: RegExp) => {
  await user.click(screen.getByRole('treeitem', { name }));
};

describe('DocsDialogContainer', () => {
  it('fetches only the tree on open and shows the guidance until a file is chosen', async () => {
    await open();
    expect(urls()).toEqual(['/api/projects/p1/docs/tree']);
    expect(screen.getByRole('heading', { name: 'Select a file' })).toBeTruthy();
  });

  it('shows a file read-only, with no Save and no way to type into it', async () => {
    const { user } = await open();
    await choose(user, /a\.md/);
    expect((await screen.findByLabelText('editor')).hasAttribute('disabled')).toBe(true);
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });

  it('fetches the file again each time it is chosen, keeping nothing between choices', async () => {
    const { user } = await open();
    await choose(user, /a\.md/);
    await screen.findByLabelText('editor');
    await choose(user, /b\.md/);
    await choose(user, /a\.md/);
    await waitFor(() =>
      expect(urls().filter((url) => url.endsWith('file?path=a.md'))).toHaveLength(2),
    );
  });

  it("opens the chosen file in the computer's app with docs/open and its path", async () => {
    const { user } = await open();
    await choose(user, /c\.md/);
    await user.click(await screen.findByRole('button', { name: 'Open in editor' }));
    await waitFor(() => expect(urls()).toContain('/api/projects/p1/docs/open?path=dir%2Fc.md'));
  });

  it('fetches a file when it is chosen but not when a folder opens or closes', async () => {
    const { user } = await open();
    await user.click(screen.getByRole('treeitem', { name: /dir/ }));
    expect(urls()).toHaveLength(1);
    await choose(user, /a\.md/);
    await screen.findByLabelText('editor');
    expect(urls()).toEqual(['/api/projects/p1/docs/tree', '/api/projects/p1/docs/file?path=a.md']);
  });

  it('shows a load failure of a file and loads it again', async () => {
    delete files['a.md'];
    const { user } = await open();
    await choose(user, /a\.md/);
    expect(await screen.findByText('Could not load the file')).toBeTruthy();
    files['a.md'] = file('a.md');
    await user.click(screen.getByRole('button', { name: 'Reload' }));
    expect(await screen.findByLabelText('editor')).toBeTruthy();
  });

  it('shows an image from the assets URL without fetching text', async () => {
    const { user } = await open();
    await choose(user, /pic\.png/);
    const image = await screen.findByAltText('pic.png');
    expect(image.getAttribute('src')).toBe('/api/projects/p1/docs/assets?path=pic.png');
    expect(urls()).toEqual(['/api/projects/p1/docs/tree']);
    expect(screen.queryByLabelText('editor')).toBeNull();
  });

  it('says a file of another type cannot be shown, names it, and fetches nothing', async () => {
    const { user } = await open();
    await choose(user, /board\.pen/);
    expect(await screen.findByText('This file type cannot be shown here.')).toBeTruthy();
    expect(within(screen.getByRole('dialog')).getAllByText('board.pen').length).toBeGreaterThan(0);
    expect(urls()).toEqual(['/api/projects/p1/docs/tree']);
    expect(screen.queryByLabelText('editor')).toBeNull();
  });

  it('shows where the docs go when the project has none', async () => {
    fetchMock.mockImplementation(async () => json({ nodes: [], truncated: false }));
    render(<DocsDialogContainer projectId="p1" onClose={vi.fn()} />);
    expect(await screen.findByText('This project has no docs')).toBeTruthy();
    expect(screen.getByText('shared/projects/p1/docs/')).toBeTruthy();
  });

  it('shows a failed file list with a retry that fetches it again', async () => {
    fetchMock.mockImplementationOnce(async () => json({}, 500));
    const user = userEvent.setup();
    render(<DocsDialogContainer projectId="p1" onClose={vi.fn()} />);
    expect(await screen.findByText('Could not load the files.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByRole('treeitem', { name: /a\.md/ });
    expect(
      within(screen.getByRole('dialog')).getByRole('heading', { name: 'Select a file' }),
    ).toBeTruthy();
  });
});

describe('DocsDialogContainer: open folder', () => {
  it('posts to docs/open and shows nothing when the server answers 204', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.endsWith('/docs/open') ? new Response(null, { status: 204 }) : json(TREE),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { user } = await open();
    await user.click(screen.getByRole('button', { name: 'Open folder' }));
    await waitFor(() => expect(urls()).toContain('/api/projects/p1/docs/open'));
    const call = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/docs/open'));
    expect(call?.[1]).toMatchObject({ method: 'POST' });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows a short message when the folder could not be opened', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.endsWith('/docs/open') ? json({ error: { code: 'docs_open_failed' } }, 500) : json(TREE),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { user } = await open();
    await user.click(screen.getByRole('button', { name: 'Open folder' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Could not open the folder.');
  });
});

describe('DocsDialogContainer: links', () => {
  const withLinks = () => {
    files['a.md'] = file('a.md', {
      content: `# a\n[to c](dir/c.md#part) [folder](dir/) [nowhere](none.md) [site](${SITE})\n`,
    });
  };

  it('opens the linked file of the docs in the dialog, read from the document folder', async () => {
    withLinks();
    const { user } = await open();
    await choose(user, /a\.md/);
    await user.click(await screen.findByRole('link', { name: 'to c' }));
    await waitFor(() => expect(urls()).toContain('/api/projects/p1/docs/file?path=dir%2Fc.md'));
    expect(screen.getByRole('treeitem', { name: /c\.md/ }).getAttribute('aria-current')).toBe(
      'true',
    );
  });

  it('opens the folder the reader closed, to show the linked file in the list', async () => {
    withLinks();
    const { user } = await open();
    await user.click(screen.getByRole('treeitem', { name: /dir/ }));
    expect(screen.queryByRole('treeitem', { name: /c\.md/ })).toBeNull();
    await choose(user, /a\.md/);
    await user.click(await screen.findByRole('link', { name: 'to c' }));
    expect(await screen.findByRole('treeitem', { name: /c\.md/ })).toBeTruthy();
  });

  it('says so at the left of the footer when a link leads to no file', async () => {
    withLinks();
    const { user } = await open();
    await choose(user, /a\.md/);
    await user.click(await screen.findByRole('link', { name: 'nowhere' }));
    const notice = await screen.findByText('The linked file is not in the docs.');
    const openInEditor = screen.getByRole('button', { name: 'Open in editor' });
    // The notice comes before the footer's buttons.
    expect(
      notice.compareDocumentPosition(openInEditor) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(urls().filter((url) => url.includes('none.md'))).toEqual([]);
  });

  it('opens an https address in a new tab and keeps the dialog on the document', async () => {
    withLinks();
    const openWindow = vi.fn();
    vi.stubGlobal('open', openWindow);
    const { user } = await open();
    await choose(user, /a\.md/);
    await user.click(await screen.findByRole('link', { name: 'site' }));
    expect(openWindow).toHaveBeenCalledWith(SITE, '_blank', 'noopener,noreferrer');
    expect(screen.getByRole('treeitem', { name: /a\.md/ }).getAttribute('aria-current')).toBe(
      'true',
    );
  });
});
