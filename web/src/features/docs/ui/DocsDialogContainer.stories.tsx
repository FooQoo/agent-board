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
  readOnly: false,
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
  (over: { tree?: Handler; file?: Handler; put?: Handler } = {}): Handler =>
  (url, init) => {
    if (init?.method === 'PUT')
      return (over.put ?? (() => json({ path: FILE.path, revision: 'sha256:2' })))(url, init);
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

/** A read-only file shows the notice and cannot be saved. */
export const ReadOnly: Story = {
  parameters: { handler: api({ file: () => json({ ...FILE, readOnly: true }) }) },
  play: async () => {
    const view = await open();
    await choose(view, /Tasks\.md/);
    await expect(await view.findByText(/This file is read-only/)).toBeVisible();
    await expect(view.getByRole('button', { name: 'Save' })).toBeDisabled();
  },
};

/** The body edits in place; Save turns on, saves, and the dialog stays open. */
export const EditAndSave: Story = {
  parameters: { handler: api() },
  play: async ({ args }) => {
    const view = await open();
    await choose(view, /Tasks\.md/);
    const save = await view.findByRole('button', { name: 'Save' });
    await expect(save).toBeDisabled();
    const crumbs = view.getByRole('navigation');
    await expect(crumbs).toHaveTextContent('Docs/Product/Tasks.md');
    await expect(view.getByText('title: Tasks', { exact: false })).toBeInTheDocument();
    await userEvent.click(await editor());
    await userEvent.keyboard('Typed ');
    await waitFor(() => expect(save).toBeEnabled());
    await expect(view.getByText('You have unsaved changes.')).toBeVisible();
    await userEvent.click(save);
    await waitFor(() => expect(save).toBeDisabled());
    await expect(view.getByText('No changes')).toBeVisible();
    await expect(args.onClose).not.toHaveBeenCalled();
  },
};

/** A save that the server refuses keeps the input and says so. */
export const SaveFailed: Story = {
  parameters: {
    handler: api({ put: () => json({ error: { code: 'x', reason: 'hidden' } }, 500) }),
  },
  play: async () => {
    const view = await open();
    await choose(view, /Tasks\.md/);
    const save = await view.findByRole('button', { name: 'Save' });
    await userEvent.click(await editor());
    await userEvent.keyboard('Typed ');
    await waitFor(() => expect(save).toBeEnabled());
    await userEvent.click(save);
    await expect(await view.findByText(/Could not save/)).toBeVisible();
    await expect(save).toBeEnabled();
  },
};

/** The file changed after it was opened: the edit stays, and Overwrite saves it over the latest. */
export const Conflict: Story = {
  parameters: {
    handler: api({
      put: (_url, init) =>
        JSON.parse(String(init?.body)).expectedRevision === 'sha256:9'
          ? json({ path: FILE.path, revision: 'sha256:10' })
          : json({ error: { code: 'docs_revision_conflict' }, currentRevision: 'sha256:9' }, 409),
    }),
  },
  play: async () => {
    const view = await open();
    await choose(view, /Tasks\.md/);
    const save = await view.findByRole('button', { name: 'Save' });
    await userEvent.click(await editor());
    await userEvent.keyboard('Typed ');
    await waitFor(() => expect(save).toBeEnabled());
    await userEvent.click(save);
    await expect(await view.findByText(/The file was changed outside/)).toBeVisible();
    await expect(document.querySelector('.ProseMirror')?.textContent).toContain('Typed');
    await expect(view.getByText('Not saved')).toBeVisible();
    await userEvent.click(view.getByRole('button', { name: 'Overwrite with mine' }));
    await waitFor(() => expect(view.queryByText(/The file was changed outside/)).toBeNull());
    await expect(view.getByText('No changes')).toBeVisible();
  },
};

/** Moving to another file with unsaved changes asks first. */
export const UnsavedMove: Story = {
  parameters: { handler: api() },
  play: async () => {
    const view = await open();
    await choose(view, /Tasks\.md/);
    await userEvent.click(await editor());
    await userEvent.keyboard('Typed ');
    await expect(await view.findByText('You have unsaved changes.')).toBeInTheDocument();
    await choose(view, /Vision\.md/);
    await waitFor(async () => expect(await view.findByText('Discard changes?')).toBeVisible());
    await userEvent.click(view.getByRole('button', { name: 'Keep editing' }));
    await expect(document.querySelector('.ProseMirror')?.textContent).toContain('Typed');
  },
};

/** An image file shows as a picture from the assets URL; Save stays off and no text is fetched. */
export const ImageFile: Story = {
  parameters: { handler: mediaApi() },
  play: async () => {
    const view = await open();
    await choose(view, /diagram\.png/);
    const image = await view.findByAltText('diagram.png');
    await expect(image.getAttribute('src')).toBe(
      '/api/projects/p-alpha/docs/assets?path=diagram.png',
    );
    await expect(view.getByRole('button', { name: 'Save' })).toBeDisabled();
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
    await expect(view.getByRole('button', { name: 'Save' })).toBeDisabled();
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
