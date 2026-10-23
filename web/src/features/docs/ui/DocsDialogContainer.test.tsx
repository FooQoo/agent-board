import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@/shared/i18n';
import { DocsDialogContainer } from './DocsDialogContainer';

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
    <textarea
      aria-label="editor"
      defaultValue={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    />
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
  readOnly: false,
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
    if (init?.method === 'PUT') return json({ path: 'a.md', revision: 'rev-new' });
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

  it('fetches a file when it is chosen but not when a folder opens or closes', async () => {
    const { user } = await open();
    await user.click(screen.getByRole('treeitem', { name: /dir/ }));
    expect(urls()).toHaveLength(1);
    await choose(user, /a\.md/);
    await screen.findByLabelText('editor');
    expect(urls()).toEqual(['/api/projects/p1/docs/tree', '/api/projects/p1/docs/file?path=a.md']);
  });

  it('keeps Save off until the text changes, then saves and stays open', async () => {
    const { user, onClose } = await open();
    await choose(user, /a\.md/);
    const editor = await screen.findByLabelText('editor');
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toHaveProperty('disabled', true);
    await user.type(editor, '!');
    expect(save).toHaveProperty('disabled', false);
    await user.click(save);
    await waitFor(() => expect(save).toHaveProperty('disabled', true));
    expect(onClose).not.toHaveBeenCalled();
    const put = fetchMock.mock.calls.find((c) => c[1]?.method === 'PUT');
    expect(JSON.parse(put?.[1].body)).toMatchObject({
      path: 'a.md',
      expectedRevision: 'rev-a.md',
    });
  });

  it('asks before moving to another file with unsaved changes, and keeps the edit on cancel', async () => {
    const { user } = await open();
    await choose(user, /a\.md/);
    await user.type(await screen.findByLabelText('editor'), '!');
    await choose(user, /b\.md/);
    const question = await screen.findByText('Discard changes?');
    expect(question).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect((screen.getByLabelText('editor') as HTMLTextAreaElement).value).toBe('# a.md\n!');
    expect(urls().some((u) => u.includes('path=b.md'))).toBe(false);

    await choose(user, /b\.md/);
    await user.click(await screen.findByRole('button', { name: 'Discard and move' }));
    await waitFor(() => expect(urls().some((u) => u.includes('path=b.md'))).toBe(true));
  });

  it('asks before closing with unsaved changes', async () => {
    const { user, onClose } = await open();
    await choose(user, /a\.md/);
    await user.type(await screen.findByLabelText('editor'), '!');
    await user.click(screen.getAllByRole('button', { name: 'Close' }).at(-1) as HTMLElement);
    expect(await screen.findByText('Discard changes?')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows a conflict with the input kept, and overwrites with the current revision', async () => {
    const { user } = await open();
    await choose(user, /a\.md/);
    await user.type(await screen.findByLabelText('editor'), '!');
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (_url: string, init?: { body?: string }) => {
      const sent = JSON.parse(init?.body ?? '{}');
      return sent.expectedRevision === 'rev-other'
        ? json({ path: 'a.md', revision: 'rev-final' })
        : json({ error: { code: 'docs_revision_conflict' }, currentRevision: 'rev-other' }, 409);
    });
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const banner = await screen.findByText(/Could not save. The file was changed/);
    expect(banner).toBeTruthy();
    expect((screen.getByLabelText('editor') as HTMLTextAreaElement).value).toBe('# a.md\n!');
    await user.click(screen.getByRole('button', { name: 'Overwrite with mine' }));
    await waitFor(() => expect(screen.queryByText(/The file was changed/)).toBeNull());
    expect(screen.getByRole('button', { name: 'Save' })).toHaveProperty('disabled', true);
  });

  it('asks before a conflict reload throws the edit away', async () => {
    const { user } = await open();
    await choose(user, /a\.md/);
    await user.type(await screen.findByLabelText('editor'), '!');
    fetchMock.mockImplementation(async () =>
      json({ error: { code: 'docs_revision_conflict' }, currentRevision: 'r2' }, 409),
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.click(await screen.findByRole('button', { name: 'Reload the latest' }));
    expect(await screen.findByText('Discard your edits and reload?')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect((screen.getByLabelText('editor') as HTMLTextAreaElement).value).toBe('# a.md\n!');
  });

  it('shows a read-only file as read-only without a way to edit', async () => {
    files['a.md'] = file('a.md', { readOnly: true });
    const { user } = await open();
    await choose(user, /a\.md/);
    expect(await screen.findByText(/This file is read-only/)).toBeTruthy();
    expect(screen.getByLabelText('editor')).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Save' })).toHaveProperty('disabled', true);
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

  it('shows an image from the assets URL without fetching text or enabling Save', async () => {
    const { user } = await open();
    await choose(user, /pic\.png/);
    const image = await screen.findByAltText('pic.png');
    expect(image.getAttribute('src')).toBe('/api/projects/p1/docs/assets?path=pic.png');
    expect(urls()).toEqual(['/api/projects/p1/docs/tree']);
    expect(screen.queryByLabelText('editor')).toBeNull();
    expect(screen.getByRole('button', { name: 'Save' })).toHaveProperty('disabled', true);
  });

  it('says a file of another type cannot be shown, names it, and fetches nothing', async () => {
    const { user } = await open();
    await choose(user, /board\.pen/);
    expect(await screen.findByText('This file type cannot be shown here.')).toBeTruthy();
    expect(within(screen.getByRole('dialog')).getAllByText('board.pen').length).toBeGreaterThan(0);
    expect(urls()).toEqual(['/api/projects/p1/docs/tree']);
    expect(screen.queryByLabelText('editor')).toBeNull();
    expect(screen.getByRole('button', { name: 'Save' })).toHaveProperty('disabled', true);
  });

  it('moves from a Markdown edit to an image only after the discard question', async () => {
    const { user } = await open();
    await choose(user, /a\.md/);
    await user.type(await screen.findByLabelText('editor'), '!');
    await choose(user, /pic\.png/);
    expect(await screen.findByText('Discard changes?')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Discard and move' }));
    expect(await screen.findByAltText('pic.png')).toBeTruthy();
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
