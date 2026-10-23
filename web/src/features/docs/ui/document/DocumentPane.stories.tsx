import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { MarkdownView } from '@/shared/markdown/MarkdownView';
import { EditorShell } from '@/shared/ui/editor/EditorShell';
import { modalDocsParameters } from '../../../../../.storybook/support/modal-docs';
import { DocumentPane, type DocumentPaneProps } from './DocumentPane';

const markdown = `## Purpose

This document lists the main features and tasks of Agent Board.

## Main features

- **Task management**: create, edit and move tasks
- **Epics**: group related tasks under one theme

## Task status

| Status | Meaning |
| --- | --- |
| Todo | Not started |
| Doing | In progress |
`;

const frontmatter = '---\ntitle: Tasks (requirements)\ntags: [product, spec]\nstatus: draft\n---\n';

/** The dialog the pane sits in. The body is a fixed Markdown view, standing in for the viewer. */
function Harness(pane: DocumentPaneProps) {
  return (
    <EditorShell
      idLabel=""
      title="Tasks.md"
      badge=""
      variant="edit"
      dirty={false}
      saving={false}
      error={null}
      status=""
      onClose={fn()}
      actions={null}
    >
      <div style={{ display: 'flex', flex: '1 1 0', minHeight: 0 }}>
        <DocumentPane {...pane}>
          <MarkdownView source={markdown} variant="wide" />
        </DocumentPane>
      </div>
    </EditorShell>
  );
}

const meta = {
  title: 'Docs/Document/DocumentPane',
  component: Harness,
  parameters: { layout: 'fullscreen', ...modalDocsParameters },
  args: { state: 'ready', onRetry: fn() },
} satisfies Meta<typeof Harness>;

export default meta;
type Story = StoryObj<typeof meta>;

const page = () => within(document.body);
const opened = async () => {
  const view = page();
  await waitFor(() => expect(view.getByRole('dialog')).toBeVisible());
  return view;
};

/** A file is open: the kind label and the body, with nothing to edit or save. */
export const Ready: Story = {
  play: async () => {
    const view = await opened();
    await expect(view.getByText('Markdown', { selector: '.docs-doc__kind' })).toBeVisible();
    await expect(view.getByRole('heading', { name: 'Purpose' })).toBeVisible();
    await expect(view.getByRole('table')).toBeVisible();
    await expect(view.queryByRole('button', { name: 'Save' })).toBeNull();
    await expect(view.queryByRole('alert')).toBeNull();
  },
};

/** The front matter sits above the body, folded at first. */
export const WithFrontmatter: Story = {
  args: { frontmatter },
  play: async () => {
    const view = await opened();
    const head = view.getByRole('button', { name: /Front matter/ });
    await expect(head).toHaveAttribute('aria-expanded', 'false');
    await expect(head).toHaveTextContent('3 items');
    await expect(view.getByText(/status: draft/)).not.toBeVisible();
    await userEvent.click(head);
    await expect(head).toHaveAttribute('aria-expanded', 'true');
    await expect(view.getByText(/status: draft/)).toBeVisible();
    await userEvent.click(head);
    await expect(view.getByText(/status: draft/)).not.toBeVisible();
  },
};

/** An .mdx file is labeled as MDX. */
export const MdxLabel: Story = {
  args: { kindLabel: 'MDX' },
  play: async () => {
    const view = await opened();
    await expect(view.getByText('MDX', { selector: '.docs-doc__kind' })).toBeVisible();
  },
};

/** The file is being read: bars stand where the text will be. */
export const Loading: Story = {
  args: { state: 'loading' },
  play: async () => {
    const view = await opened();
    await expect(view.getByRole('status', { name: 'Loading the file…' })).toBeVisible();
    await expect(view.queryByRole('heading', { name: 'Purpose' })).toBeNull();
  },
};

/** The read failed: the reason and a way to try again. */
export const LoadError: Story = {
  args: { state: 'error' },
  play: async ({ args }) => {
    const view = await opened();
    await expect(view.getByRole('alert')).toHaveTextContent('Could not load the file');
    await userEvent.click(view.getByRole('button', { name: 'Reload' }));
    await expect(args.onRetry).toHaveBeenCalledTimes(1);
  },
};

/** Japanese in the dark theme, with the front matter. */
export const JapaneseDark: Story = {
  args: { frontmatter },
  globals: { locale: 'ja', mode: 'dark' },
  play: async () => {
    const view = await opened();
    await expect(view.getByRole('button', { name: /フロントマター/ })).toBeVisible();
  },
};

/** The phone layout: smaller margins. */
export const Phone: Story = {
  args: { compact: true, frontmatter },
  globals: { width: 'phone-390' },
  play: async () => {
    const view = await opened();
    await expect(view.getByRole('heading', { name: 'Purpose' })).toBeVisible();
  },
};
