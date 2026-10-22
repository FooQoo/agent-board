import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { Button } from '@/shared/ui/button';
import { docsRootPath, docsTree } from '../../../../../.storybook/support/docs-fixtures';
import { modalDocsParameters } from '../../../../../.storybook/support/modal-docs';
import { DocsDialogView, DOCS_LIST_WIDTH, type DocsDialogViewProps } from './DocsDialogView';

const meta = {
  title: 'Docs/Shell/DocsDialogView',
  component: DocsDialogView,
  parameters: { layout: 'fullscreen', ...modalDocsParameters },
  args: {
    status: 'ready',
    // The tests run in a narrow window; the phone layout is asked for by its own Stories.
    compact: false,
    tree: docsTree,
    selectedPath: null,
    onSelectFile: fn(),
    listWidth: DOCS_LIST_WIDTH.default,
    onResize: fn(),
    onClose: fn(),
  },
} satisfies Meta<typeof DocsDialogView>;

export default meta;
type Story = StoryObj<typeof meta>;

const page = () => within(document.body);
/** The dialog fades in; its content counts as visible once the dialog itself does. */
const opened = async () => {
  const view = page();
  await waitFor(() => expect(view.getByRole('dialog')).toBeVisible());
  return view;
};
const footerOf = (view: ReturnType<typeof page>) =>
  within(view.getByRole('dialog').querySelector<HTMLElement>('.editor__footer') as HTMLElement);

const body = (
  <div style={{ padding: 32 }}>
    <h2>Tasks</h2>
    <p>The body pane holds the document.</p>
  </div>
);

/** No file chosen: the list is on the left, the guidance fills the center, and the footer only closes. */
export const NoFileSelected: Story = {
  play: async () => {
    const view = await opened();
    await expect(view.getByRole('dialog')).toHaveAccessibleName('Docs');
    await expect(view.getByRole('heading', { name: 'Select a file' })).toBeVisible();
    await expect(view.getAllByRole('treeitem').length).toBeGreaterThan(0);
    await expect(footerOf(view).getAllByRole('button')).toHaveLength(1);
    await expect(footerOf(view).getByRole('button', { name: 'Close' })).toBeVisible();
  },
};

/** The same screen in Japanese and in the dark theme. */
export const NoFileSelectedJapaneseDark: Story = {
  globals: { locale: 'ja', mode: 'dark' },
  play: async () => {
    await expect(
      (await opened()).getByRole('heading', { name: 'ファイルを選択してください' }),
    ).toBeVisible();
  },
};

/** A chosen file: the row is marked, the body pane shows the children, the footer carries the actions. */
export const FileSelected: Story = {
  args: {
    selectedPath: 'Product/Tasks.md',
    children: body,
    footerStatus: 'No changes',
    actions: <Button disabled>Save</Button>,
  },
  play: async () => {
    const view = await opened();
    await expect(view.getByRole('treeitem', { current: true })).toHaveTextContent('Tasks.md');
    await expect(view.getByRole('heading', { name: 'Tasks' })).toBeVisible();
    await expect(view.queryByRole('heading', { name: 'Select a file' })).toBeNull();
    await expect(view.getByRole('button', { name: 'Save' })).toBeDisabled();
  },
};

/** Unsaved changes: the footer says so and Save is on. Closing asks first. */
export const Editing: Story = {
  args: {
    selectedPath: 'Product/Tasks.md',
    children: body,
    dirty: true,
    footerStatus: 'Unsaved changes',
    actions: <Button>Save</Button>,
  },
  play: async ({ args }) => {
    const view = await opened();
    await expect(view.getByText('Unsaved changes')).toBeVisible();
    await userEvent.click(footerOf(view).getByRole('button', { name: 'Close' }));
    await expect(args.onClose).not.toHaveBeenCalled();
    await waitFor(() => expect(view.getByText('Discard and close')).toBeVisible());
  },
};

/** The project has no docs: the list is empty, the center names the folder, the footer only closes. */
export const NoDocs: Story = {
  args: { tree: [], rootPath: docsRootPath },
  play: async () => {
    const view = await opened();
    await expect(view.getByText('No files')).toBeVisible();
    await expect(view.getByRole('heading', { name: 'This project has no docs' })).toBeVisible();
    await expect(view.getByText(docsRootPath)).toBeVisible();
    await expect(view.getByRole('button', { name: 'Copy the folder path' })).toBeVisible();
    await expect(view.queryByRole('button', { name: 'Save' })).toBeNull();
    await expect(footerOf(view).getAllByRole('button')).toHaveLength(1);
  },
};

/** The file list is loading. */
export const TreeLoading: Story = {
  args: { status: 'loading', tree: [] },
  play: async () => {
    await expect((await opened()).getByText('Loading files…')).toBeVisible();
  },
};

/** The file list failed to load: the message and a retry in the list. */
export const TreeError: Story = {
  args: { status: 'error', tree: [], onRetry: fn() },
  play: async ({ args }) => {
    const view = await opened();
    await expect(view.getByText('Could not load the files.')).toBeVisible();
    await userEvent.click(view.getByRole('button', { name: 'Retry' }));
    await expect(args.onRetry).toHaveBeenCalledTimes(1);
  },
};

/** A save error shows in the band above the footer; the footer buttons stay as they are. */
export const SaveError: Story = {
  args: {
    selectedPath: 'Product/Tasks.md',
    children: body,
    dirty: true,
    error: 'Could not save the file.',
    actions: <Button>Save</Button>,
  },
  play: async () => {
    const view = await opened();
    await expect(view.getByRole('alert')).toHaveTextContent('Could not save the file.');
    await expect(view.queryByRole('button', { name: 'Retry' })).toBeNull();
    await expect(view.getByRole('button', { name: 'Save' })).toBeEnabled();
  },
};

function Host(props: Partial<DocsDialogViewProps>) {
  const [width, setWidth] = useState<number>(DOCS_LIST_WIDTH.default);
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <DocsDialogView
      status="ready"
      tree={docsTree}
      selectedPath={selected}
      onSelectFile={setSelected}
      listWidth={width}
      onResize={setWidth}
      onClose={fn()}
      {...props}
    >
      {body}
    </DocsDialogView>
  );
}

/** Dragging the handle changes the list width, between the lower and upper limits. */
export const ResizeList: Story = {
  render: () => <Host />,
  play: async () => {
    const view = await opened();
    const list = view.getByRole('dialog').querySelector<HTMLElement>('.docs-dialog__list');
    const handle = view.getByRole('separator', { name: 'Resize the file list' });
    // A synthetic pointer is not an active pointer, so the browser would refuse the capture.
    handle.setPointerCapture = () => {};
    await expect(list).toHaveStyle({ width: `${DOCS_LIST_WIDTH.default}px` });
    const dragTo = (to: number) => {
      const fire = (type: string, clientX: number) =>
        handle.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX, pointerId: 1 }));
      fire('pointerdown', 300);
      fire('pointermove', to);
      fire('pointerup', to);
    };
    dragTo(360);
    await waitFor(() => expect(list).toHaveStyle({ width: `${DOCS_LIST_WIDTH.default + 60}px` }));
    dragTo(5000);
    await waitFor(() => expect(list).toHaveStyle({ width: `${DOCS_LIST_WIDTH.max}px` }));
    dragTo(-5000);
    await waitFor(() => expect(list).toHaveStyle({ width: `${DOCS_LIST_WIDTH.min}px` }));
  },
};

/** Choosing a file in the list switches the center from the guidance to the body. */
export const ChooseFile: Story = {
  render: () => <Host />,
  play: async () => {
    const view = await opened();
    await expect(view.getByRole('heading', { name: 'Select a file' })).toBeVisible();
    await userEvent.click(view.getByRole('treeitem', { name: 'Vision.md' }));
    await expect(view.getByRole('heading', { name: 'Tasks' })).toBeVisible();
    await expect(view.queryByRole('heading', { name: 'Select a file' })).toBeNull();
  },
};

/** Phone width, no file: the list fills the screen under the guidance and there is no resize handle. */
export const PhoneFileList: Story = {
  args: { compact: true },
  globals: { width: 'phone-390' },
  play: async () => {
    const view = await opened();
    await expect(view.getByText('Choose a Markdown file to show it.')).toBeVisible();
    await expect(view.getAllByRole('treeitem').length).toBeGreaterThan(0);
    await expect(view.queryByRole('separator')).toBeNull();
  },
};

/** Phone width, a file chosen: the body fills the screen and the list is hidden. */
export const PhoneBody: Story = {
  args: { compact: true, selectedPath: 'Product/Tasks.md', children: body },
  globals: { width: 'phone-390' },
  play: async () => {
    const view = await opened();
    await expect(view.getByRole('heading', { name: 'Tasks' })).toBeVisible();
    await expect(view.queryByRole('tree')).toBeNull();
  },
};
