import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState, type ReactNode } from 'react';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { docsTree } from '../../../../.storybook/support/docs-fixtures';
import { modalDocsParameters } from '../../../../.storybook/support/modal-docs';
import { DocsDialogContainer } from './DocsDialogContainer';

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response> | 'never';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const FRONT = '---\ntitle: Tasks\nstatus: draft\n---\n';
const FILE = {
  path: 'Product/Tasks.md',
  content: `${FRONT}## Purpose\n\nThe main tasks of Agent Board.\n\n| Status | Meaning |\n| --- | --- |\n| Todo | Not started |\n`,
  revision: 'sha256:1',
};

/** Answers the docs API of the story's project; installed before the dialog fetches and removed after. */
function MockApi({ handler, children }: { handler: Handler; children: ReactNode }) {
  const [original] = useState(() => {
    const previous = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const answer = handler(String(input), init);
      return answer === 'never' ? new Promise<Response>(() => {}) : answer;
    }) as typeof fetch;
    return previous;
  });
  useEffect(
    () => () => {
      globalThis.fetch = original;
    },
    [original],
  );
  return children;
}

const api =
  (over: { tree?: Handler; file?: Handler; open?: Handler } = {}): Handler =>
  (url, init) => {
    if (init?.method === 'POST' && url.includes('/docs/open'))
      return (over.open ?? (() => new Response(null, { status: 204 })))(url, init);
    if (url.endsWith('/docs/tree'))
      return (over.tree ?? (() => json({ nodes: docsTree, truncated: false })))(url, init);
    return (over.file ?? (() => json(FILE)))(url, init);
  };

const MEDIA_TREE = [
  ...docsTree,
  { name: 'diagram.png', path: 'diagram.png', kind: 'file', viewer: 'image' },
  { name: 'board.pen', path: 'board.pen', kind: 'file', viewer: 'other' },
] as const;
const mediaApi = () => api({ tree: () => json({ nodes: MEDIA_TREE, truncated: false }) });

const meta = {
  title: 'Docs/DocsDialogContainer',
  component: DocsDialogContainer,
  parameters: { layout: 'fullscreen', ...modalDocsParameters },
  args: { projectId: 'p-alpha', onClose: fn() },
  render: (args, { parameters }) => (
    <MockApi handler={parameters.handler as Handler}>
      <DocsDialogContainer {...args} />
    </MockApi>
  ),
} satisfies Meta<typeof DocsDialogContainer>;

export default meta;
type Story = StoryObj<typeof meta>;

const page = () => within(document.body);
const open = async () => {
  const view = page();
  await waitFor(() => expect(view.getByRole('dialog')).toBeVisible());
  return view;
};
const choose = async (view: ReturnType<typeof page>, name: string | RegExp) => {
  const [first] = await view.findAllByRole('treeitem', { name });
  await userEvent.click(first as HTMLElement);
};
const editor = async () => {
  const found = await waitFor(() => {
    const element = document.querySelector<HTMLElement>('.ProseMirror');
    if (!element) throw new Error('editor not ready');
    return element;
  });
  return found;
};

const opened = fn();

/** Open folder asks the server to open the docs folder (POST docs/open); the answer 204 shows nothing. */
export const OpenFolder: Story = {
  parameters: {
    handler: api({
      open: (url, init) => {
        opened(url, init?.method);
        return new Response(null, { status: 204 });
      },
    }),
  },
  play: async () => {
    opened.mockClear();
    const view = await open();
    await userEvent.click(await view.findByRole('button', { name: 'Open folder' }));
    await waitFor(() =>
      expect(opened).toHaveBeenCalledWith('/api/projects/p-alpha/docs/open', 'POST'),
    );
    await expect(view.queryByRole('alert')).toBeNull();
  },
};

/** The server could not open the folder: the message appears beside the button. */
export const OpenFolderFailed: Story = {
  parameters: {
    handler: api({ open: () => json({ error: { code: 'docs_open_failed' } }, 500) }),
  },
  play: async () => {
    const view = await open();
    await userEvent.click(await view.findByRole('button', { name: 'Open folder' }));
    await expect(await view.findByText('Could not open the folder.')).toBeVisible();
  },
};

/** The dialog opens with the file list and the guidance to choose a file. */
export const NoFileSelected: Story = {
  parameters: { handler: api() },
  play: async () => {
    const view = await open();
    await expect(await view.findByRole('heading', { name: 'Select a file' })).toBeVisible();
    await expect(await view.findByRole('treeitem', { name: /Vision\.md/ })).toBeVisible();
  },
};

/** The file list is still loading. */
export const TreeLoading: Story = {
  parameters: { handler: api({ tree: () => 'never' }) },
  play: async () => {
    await expect(await (await open()).findByText('Loading files…')).toBeVisible();
  },
};

/** The project has no docs: the center names the folder. */
export const NoDocs: Story = {
  parameters: { handler: api({ tree: () => json({ nodes: [], truncated: false }) }) },
  play: async () => {
    const view = await open();
    await expect(await view.findByText('This project has no docs')).toBeVisible();
    await expect(view.getByText('shared/projects/p-alpha/docs/')).toBeVisible();
  },
};

/** The file list failed: a message and Retry. */
export const TreeError: Story = {
  parameters: { handler: api({ tree: () => json({}, 500) }) },
  play: async () => {
    const view = await open();
    await expect(await view.findByText('Could not load the files.')).toBeVisible();
    await expect(view.getByRole('button', { name: 'Retry' })).toBeVisible();
  },
};

/** A chosen file is loading. */
export const FileLoading: Story = {
  parameters: { handler: api({ file: () => 'never' }) },
  play: async () => {
    const view = await open();
    await choose(view, /Tasks\.md/);
    await expect(await view.findByRole('status', { name: 'Loading the file…' })).toBeVisible();
  },
};

/** A chosen file failed to load: the message and Reload. */
export const FileError: Story = {
  parameters: { handler: api({ file: () => json({ error: { code: 'docs_not_found' } }, 404) }) },
  play: async () => {
    const view = await open();
    await choose(view, /Tasks\.md/);
    await expect(await view.findByText('Could not load the file')).toBeVisible();
    await expect(view.getByRole('button', { name: 'Reload' })).toBeVisible();
  },
};

/** Moving from an .mdx file to a Markdown file shows the Markdown file's own text. */
export const MdxThenMarkdown: Story = {
  parameters: {
    handler: api({
      tree: () =>
        json({
          nodes: [
            ...docsTree,
            { name: 'demo.mdx', path: 'demo.mdx', kind: 'file', viewer: 'markdown' },
          ],
          truncated: false,
        }),
      file: (url) =>
        url.includes('demo.mdx')
          ? json({ path: 'demo.mdx', content: '# Only in MDX\n', revision: 'sha256:m' })
          : json(FILE),
    }),
  },
  play: async () => {
    const view = await open();
    await choose(view, /demo\.mdx/);
    await expect(await view.findByText('MDX', { selector: '.docs-doc__kind' })).toBeVisible();
    await choose(view, /Tasks\.md/);
    await waitFor(async () => expect((await editor()).textContent).toContain('The main tasks'));
    await expect((await editor()).textContent).not.toContain('Only in MDX');
  },
};

const openedFile = fn();

/** Open in editor asks the server to open the chosen file in the computer's app for it. */
export const OpenInEditor: Story = {
  parameters: {
    handler: api({
      open: (url) => {
        openedFile(url);
        return new Response(null, { status: 204 });
      },
    }),
  },
  play: async () => {
    openedFile.mockClear();
    const view = await open();
    await choose(view, /Tasks\.md/);
    await userEvent.click(await view.findByRole('button', { name: 'Open in editor' }));
    await waitFor(() =>
      expect(openedFile).toHaveBeenCalledWith(
        '/api/projects/p-alpha/docs/open?path=Product%2FTasks.md',
      ),
    );
    await expect(view.queryByRole('alert')).toBeNull();
  },
};

/** The file could not be opened: the footer says so before the buttons. */
export const OpenInEditorFailed: Story = {
  parameters: {
    handler: api({ open: () => json({ error: { code: 'docs_not_found' } }, 404) }),
  },
  play: async () => {
    const view = await open();
    await choose(view, /Tasks\.md/);
    await userEvent.click(await view.findByRole('button', { name: 'Open in editor' }));
    await expect(await view.findByRole('alert')).toHaveTextContent('Could not open the file.');
  },
};

// The board's notices for the story: `notifyDocs` plays a change on disk.
let docsListener: ((projectId: string | null) => void) | null = null;
const subscribeDocs = (listener: (projectId: string | null) => void) => {
  docsListener = listener;
  return () => {
    docsListener = null;
  };
};
const notifyDocs = () => docsListener?.('p-alpha');
let revision = 1;

type Node = { path: string; children?: readonly Node[] };
/** The fixture's list without the open file, as after it was deleted on disk. */
const withoutTasks = (function drop(nodes: readonly Node[]): Node[] {
  return nodes
    .filter((node) => node.path !== FILE.path)
    .map((node) => (node.children ? { ...node, children: drop(node.children) } : node));
})(docsTree as readonly Node[]);

/** A change on disk: the open file is shown again with its new text, and the footer says why. */
export const FollowsChanges: Story = {
  args: { subscribeChanges: subscribeDocs },
  beforeEach: () => {
    revision = 1;
  },
  parameters: {
    handler: api({
      file: () =>
        json({
          ...FILE,
          content: revision === 1 ? FILE.content : `${FRONT}## Changed on disk\n`,
          revision: `sha256:${revision}`,
        }),
    }),
  },
  play: async () => {
    const view = await open();
    await choose(view, /Tasks\.md/);
    await waitFor(async () => expect((await editor()).textContent).toContain('The main tasks'));
    revision = 2;
    notifyDocs();
    await waitFor(async () => expect((await editor()).textContent).toContain('Changed on disk'));
    await expect(
      await view.findByText(/The file changed, so the view was updated \(\d{2}:\d{2}\)/),
    ).toBeVisible();
  },
};

/** The open file was deleted on disk: it stays on screen, and the left of the footer says it was deleted. */
export const FollowsDeletion: Story = {
  args: { subscribeChanges: subscribeDocs },
  beforeEach: () => {
    revision = 1;
  },
  parameters: {
    handler: api({
      tree: () => json({ nodes: revision === 1 ? docsTree : withoutTasks, truncated: false }),
    }),
  },
  play: async () => {
    const view = await open();
    await choose(view, /Tasks\.md/);
    await waitFor(async () => expect((await editor()).textContent).toContain('The main tasks'));
    revision = 2;
    notifyDocs();
    const notice = await view.findByText(/This file was deleted \(\d{2}:\d{2}\)/);
    await expect(notice).toBeVisible();
    // The notice sits at the left of the footer, apart from its buttons at the right.
    const footer = notice.closest('.editor__footer') as HTMLElement;
    const button = view.getByRole('button', { name: 'Open in editor' });
    await expect(
      notice.getBoundingClientRect().left - footer.getBoundingClientRect().left,
    ).toBeLessThan(40);
    await expect(notice.getBoundingClientRect().right).toBeLessThan(
      button.getBoundingClientRect().left,
    );
    await expect((await editor()).textContent).toContain('The main tasks');
    await waitFor(() =>
      expect(view.getAllByRole('treeitem', { name: /Tasks\.md/ })).toHaveLength(1),
    );
  },
};

/** An image file shows as a picture from the assets URL, and no text is fetched. */
export const ImageFile: Story = {
  parameters: { handler: mediaApi() },
  play: async () => {
    const view = await open();
    await choose(view, /diagram\.png/);
    const image = await view.findByAltText('diagram.png');
    await expect(image.getAttribute('src')).toBe(
      '/api/projects/p-alpha/docs/assets?path=diagram.png',
    );
    await expect(view.getByRole('navigation')).toHaveTextContent('Docs/diagram.png');
  },
};

/** A file of another type is listed, and the body says it cannot be shown. */
export const OtherFile: Story = {
  parameters: { handler: mediaApi() },
  play: async () => {
    const view = await open();
    await choose(view, /board\.pen/);
    await expect(await view.findByText('This file type cannot be shown here.')).toBeVisible();
    await expect(view.getAllByText('board.pen').length).toBeGreaterThan(1);
    await expect(view.getByRole('button', { name: 'Open in editor' })).toBeVisible();
  },
};

/** The dialog in Japanese and the dark theme. */
export const JapaneseDark: Story = {
  globals: { locale: 'ja', mode: 'dark' },
  parameters: { handler: api() },
  play: async () => {
    await expect(
      await (await open()).findByRole('heading', { name: 'ファイルを選択してください' }),
    ).toBeVisible();
  },
};
