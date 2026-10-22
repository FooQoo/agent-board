import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, userEvent, within } from 'storybook/test';
import { docsTree } from '../../../../../.storybook/support/docs-fixtures';
import { DocsFileTree, type DocsTreeNode } from './DocsFileTree';

const meta = {
  title: 'Docs/Shell/DocsFileTree',
  component: DocsFileTree,
  args: { nodes: docsTree, selectedPath: null, onSelectFile: fn() },
  decorators: [
    (Story) => (
      <div style={{ width: 256 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof DocsFileTree>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Every folder starts open, as in the mock; a click on a file reports its path. */
export const FoldersOpen: Story = {
  play: async ({ args, canvasElement }) => {
    const tree = within(canvasElement);
    await expect(tree.getByRole('tree')).toHaveAccessibleName('Document files');
    await expect(tree.getAllByRole('treeitem')).toHaveLength(14);
    await userEvent.click(tree.getByRole('treeitem', { name: 'Vision.md' }));
    await expect(args.onSelectFile).toHaveBeenCalledWith('Strategy/Vision.md');
  },
};

/** The chosen file is marked as current; nothing else is. */
export const SelectedFile: Story = {
  args: { selectedPath: 'Product/Tasks.md' },
  play: async ({ canvasElement }) => {
    const tree = within(canvasElement);
    const current = tree.getByRole('treeitem', { current: true });
    await expect(current).toHaveTextContent('Tasks.md');
    await expect(tree.getAllByRole('treeitem', { current: true })).toHaveLength(1);
  },
};

function Toggle() {
  const [selected, setSelected] = useState<string | null>(null);
  return <DocsFileTree nodes={docsTree} selectedPath={selected} onSelectFile={setSelected} />;
}

/** A folder closes and opens again; closing it hides its files, and the folder is never "selected". */
export const FolderToggle: Story = {
  render: () => <Toggle />,
  play: async ({ canvasElement }) => {
    const tree = within(canvasElement);
    const product = tree.getByRole('treeitem', { name: 'Product' });
    await expect(product).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(product);
    await expect(product).toHaveAttribute('aria-expanded', 'false');
    await expect(tree.queryByRole('treeitem', { name: 'Mobile Monitor.md' })).toBeNull();
    await userEvent.click(product);
    await expect(tree.getByRole('treeitem', { name: 'Mobile Monitor.md' })).toBeVisible();
    await userEvent.click(tree.getByRole('treeitem', { name: 'Mobile Monitor.md' }));
    await expect(tree.getByRole('treeitem', { current: true })).toHaveTextContent(
      'Mobile Monitor.md',
    );
  },
};

const longName = 'A very long document name that does not fit the width of the file list at all.md';
const longNodes: DocsTreeNode[] = [
  {
    name: 'Folder with a very long name that does not fit the width either',
    path: 'long',
    kind: 'dir',
    children: [{ name: longName, path: `long/${longName}`, kind: 'file' }],
  },
];

/** A long name stays on one line and is cut with an ellipsis; its full name is the tooltip. */
export const LongNames: Story = {
  args: { nodes: longNodes },
  play: async ({ canvasElement }) => {
    const item = within(canvasElement).getByRole('treeitem', { name: longName });
    const label = item.querySelector<HTMLElement>('.docs-tree__name');
    await expect(label).not.toBeNull();
    await expect(item).toHaveAttribute('title', longName);
    await expect(label?.scrollWidth).toBeGreaterThan(label?.clientWidth ?? 0);
    await expect(item.getBoundingClientRect().width).toBeLessThanOrEqual(256);
  },
};

/** No file at all: the list says so. */
export const Empty: Story = {
  args: { nodes: [] },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('No files')).toBeVisible();
    await expect(within(canvasElement).queryByRole('treeitem')).toBeNull();
  },
};

/** The same list in Japanese. */
export const Japanese: Story = {
  globals: { locale: 'ja' },
  args: { nodes: [] },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('ファイルがありません')).toBeVisible();
  },
};
