import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { MarkdownView } from '@/shared/markdown/MarkdownView';
import { Button } from '@/shared/ui/button';
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

interface HarnessProps extends DocumentPaneProps {
  dirty?: boolean;
  saving?: boolean;
  error?: string | null;
  /** An editable stand-in for the editor, so the Stories can check that the input stays. */
  editable?: boolean;
  /** An .mdx file: the UI / Code switch, with a fixed stand-in for the sandbox preview. */
  mdxFile?: boolean;
}

/** The dialog the pane sits in. The body is a fixed Markdown view, standing in for the editor. */
function Harness({
  dirty = false,
  saving = false,
  error = null,
  editable = false,
  mdxFile = false,
  ...pane
}: HarnessProps) {
  const [text, setText] = useState('My unsaved edit');
  const [view, setView] = useState<'ui' | 'code'>('code');
  const mdx = mdxFile
    ? {
        view,
        onViewChange: setView,
        // The real preview is an iframe of the sandbox page; the story shows its look only.
        preview: <span role="note">Unregistered component: Chart</span>,
      }
    : undefined;
  return (
    <EditorShell
      idLabel=""
      title="Tasks.md"
      badge=""
      variant="edit"
      dirty={dirty}
      saving={saving}
      error={error}
      status={dirty ? 'You have unsaved changes.' : 'No changes'}
      onClose={fn()}
      actions={
        <Button type="button" disabled={!dirty || saving}>
          Save
        </Button>
      }
    >
      <div style={{ display: 'flex', flex: '1 1 0', minHeight: 0 }}>
        <DocumentPane {...pane} mdx={mdx}>
          {editable ? (
            <textarea
              aria-label="Body"
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          ) : (
            <MarkdownView source={markdown} variant="wide" />
          )}
        </DocumentPane>
      </div>
    </EditorShell>
  );
}

const meta = {
  title: 'Docs/Document/DocumentPane',
  component: Harness,
  parameters: { layout: 'fullscreen', ...modalDocsParameters },
  args: {
    state: 'ready',
    onReload: fn(),
    onOverwrite: fn(),
    onRetry: fn(),
  },
} satisfies Meta<typeof Harness>;

export default meta;
type Story = StoryObj<typeof meta>;

const page = () => within(document.body);
const opened = async () => {
  const view = page();
  await waitFor(() => expect(view.getByRole('dialog')).toBeVisible());
  return view;
};
const saveButton = (view: ReturnType<typeof page>) => view.getByRole('button', { name: 'Save' });

/** A file is open and unchanged: the kind label, the body, and Save is off. */
export const Ready: Story = {
  play: async () => {
    const view = await opened();
    await expect(view.getByText('Markdown', { selector: '.docs-doc__kind' })).toBeVisible();
    await expect(view.getByRole('heading', { name: 'Purpose' })).toBeVisible();
    await expect(view.getByRole('table')).toBeVisible();
    await expect(view.getByText('No changes')).toBeVisible();
    await expect(saveButton(view)).toBeDisabled();
    await expect(view.queryByRole('alert')).toBeNull();
  },
};

/** The front matter sits above the body and folds. */
export const WithFrontmatter: Story = {
  args: { frontmatter },
  play: async () => {
    const view = await opened();
    const head = view.getByRole('button', { name: /Front matter/ });
    await expect(head).toHaveAttribute('aria-expanded', 'true');
    await expect(head).toHaveTextContent('3 items');
    await expect(view.getByText(/status: draft/)).toBeVisible();
    await userEvent.click(head);
    await expect(head).toHaveAttribute('aria-expanded', 'false');
    await expect(view.getByText(/status: draft/)).not.toBeVisible();
    await userEvent.click(head);
    await expect(view.getByText(/status: draft/)).toBeVisible();
  },
};

/** There are unsaved changes: the footer says so and Save is on. */
export const Editing: Story = {
  args: { dirty: true, frontmatter },
  play: async () => {
    const view = await opened();
    await expect(view.getByText('You have unsaved changes.')).toBeVisible();
    await expect(saveButton(view)).toBeEnabled();
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

/** The file cannot be edited: a notice, and Save stays off. */
export const ReadOnly: Story = {
  args: { readOnly: true },
  play: async () => {
    const view = await opened();
    await expect(
      view.getByText('This file is read-only. You cannot edit or save it.'),
    ).toBeVisible();
    await expect(saveButton(view)).toBeDisabled();
  },
};

/** The save is under way: the footer says so and the buttons are off. */
export const Saving: Story = {
  args: { dirty: true, saving: true },
  play: async () => {
    const view = await opened();
    await expect(view.getByText('Saving…')).toBeVisible();
    await expect(saveButton(view)).toBeDisabled();
  },
};

/** The save failed: only the message shows, with no retry; Save stays on for another try. */
export const SaveFailed: Story = {
  args: { dirty: true, error: 'Could not save. Your input is kept.' },
  play: async () => {
    const view = await opened();
    await expect(view.getByRole('alert')).toHaveTextContent('Could not save. Your input is kept.');
    await expect(view.queryByRole('button', { name: 'Retry' })).toBeNull();
    await expect(saveButton(view)).toBeEnabled();
  },
};

/** The file changed on disk: two choices, and the input stays whatever is chosen. */
export const Conflict: Story = {
  args: { dirty: true, conflict: true, editable: true },
  play: async ({ args }) => {
    const view = await opened();
    const banner = view.getByRole('alert');
    await expect(banner).toHaveTextContent('The file was changed outside this screen');
    const body = view.getByRole('textbox', { name: 'Body' });
    await userEvent.type(body, ' and more');
    // Reload asks before it throws the edit away; "Keep editing" leaves everything as it was.
    await userEvent.click(view.getByRole('button', { name: 'Reload the latest' }));
    await expect(args.onReload).not.toHaveBeenCalled();
    await userEvent.click(view.getByRole('button', { name: 'Keep editing' }));
    await expect(args.onReload).not.toHaveBeenCalled();
    await expect(body).toHaveValue('My unsaved edit and more');
    await userEvent.click(view.getByRole('button', { name: 'Reload the latest' }));
    await userEvent.click(view.getByRole('button', { name: 'Discard and reload' }));
    await expect(args.onReload).toHaveBeenCalledTimes(1);
    // Overwrite saves at once, with no question.
    await userEvent.click(view.getByRole('button', { name: 'Overwrite with mine' }));
    await expect(args.onOverwrite).toHaveBeenCalledTimes(1);
  },
};

/** The overwrite is being saved: both choices are off. */
export const ConflictOverwriting: Story = {
  args: { dirty: true, conflict: true, conflictBusy: true },
  play: async () => {
    const view = await opened();
    await expect(view.getByRole('button', { name: 'Overwriting…' })).toBeDisabled();
    await expect(view.getByRole('button', { name: 'Reload the latest' })).toBeDisabled();
  },
};

/** The same pane in Japanese and in the dark theme. */
export const ConflictJapaneseDark: Story = {
  args: { dirty: true, conflict: true, frontmatter },
  globals: { locale: 'ja', mode: 'dark' },
  play: async () => {
    const view = await opened();
    await expect(view.getByRole('button', { name: '最新を再読み込み' })).toBeVisible();
    await expect(view.getByRole('button', { name: '自分の内容で上書き' })).toBeVisible();
    await expect(view.getByRole('button', { name: /フロントマター/ })).toHaveTextContent('3項目');
  },
};

/** The phone layout: smaller margins, and the notice stacks. */
export const Phone: Story = {
  args: { compact: true, frontmatter, dirty: true, conflict: true },
  globals: { width: 'phone-390' },
  play: async () => {
    const view = await opened();
    await expect(view.getByRole('button', { name: 'Overwrite with mine' })).toBeVisible();
    await expect(view.getByRole('heading', { name: 'Purpose' })).toBeVisible();
  },
};

/** An .mdx file opens as code; the switch shows the UI and back, and the editor stays. */
export const MdxSwitch: Story = {
  args: { mdxFile: true, editable: true },
  play: async () => {
    const view = await opened();
    const ui = view.getByRole('button', { name: 'UI' });
    const code = view.getByRole('button', { name: 'Code' });
    await expect(code).toHaveAttribute('aria-pressed', 'true');
    await expect(view.getByRole('textbox', { name: 'Body' })).toBeVisible();
    await userEvent.click(ui);
    await expect(ui).toHaveAttribute('aria-pressed', 'true');
    await expect(view.getByText('Unregistered component: Chart')).toBeVisible();
    await expect(view.getByRole('textbox', { name: 'Body', hidden: true })).not.toBeVisible();
    await userEvent.click(code);
    await expect(view.getByRole('textbox', { name: 'Body' })).toHaveValue('My unsaved edit');
  },
};

/** A Markdown file has no switch. */
export const NoMdxSwitch: Story = {
  play: async () => {
    const view = await opened();
    await expect(view.queryByRole('group', { name: 'View' })).toBeNull();
  },
};

/** The switch in Japanese. */
export const MdxSwitchJapanese: Story = {
  args: { mdxFile: true },
  globals: { locale: 'ja' },
  play: async () => {
    const view = await opened();
    await expect(view.getByRole('group', { name: '表示' })).toBeVisible();
    await expect(view.getByRole('button', { name: 'コード' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  },
};
