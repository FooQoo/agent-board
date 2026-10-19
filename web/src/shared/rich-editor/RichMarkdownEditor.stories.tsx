import type { Meta, StoryObj } from '@storybook/react-vite';
import { useCallback, useRef, useState } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { SAMPLE_IMAGE_URL } from '../../../.storybook/support/fixtures';
import { RichMarkdownEditor, type RichMarkdownEditorHandle } from './RichMarkdownEditor';
// The product loads these with the editor shell; a Story shows the editor in the same colors.
import '../styles/rich-body.css';
import '../styles/rich-table.css';

const IMAGE_ID = '0123456789abcdef0123456789abcdef';
const MISSING_ID = 'fedcba9876543210fedcba9876543210';

const resolveAttachment = (id: string) => (id === IMAGE_ID ? SAMPLE_IMAGE_URL : null);

const OUTLINE =
  '## Goal\n\nKeep the *original* text.\n\n## Steps\n\n* First\n* Second\n\n## Result\n\nDone.\n';
const TABLE = '## Table\n\n| Name | Value |\n| --- | --- |\n| alpha | 1 |\n| beta | 2 |\n';
const IMAGES = `## Pictures\n\n![Found picture](assets/${IMAGE_ID}.png)\n\n![Lost picture](attachment:${MISSING_ID} "Gone")\n`;
const CODE =
  '## Code\n\n```ts\nconst answer: number = 42;\n```\n\n```python\nprint("hello")\n```\n\n```unknownlang\nplain words\n```\n';
const DIAGRAM = '## Diagram\n\n```mermaid\nflowchart TD\n  Plan --> Build --> Check\n```\n';
const BROKEN_DIAGRAM = '## Diagram\n\n```mermaid\nflowchart TD\n  BROKEN [\n```\n';
const LONG = Array.from(
  { length: 12 },
  (_, n) =>
    `## Section ${n + 1}\n\nParagraph ${n + 1} of a long description.\n\n- point a\n- point b\n`,
).join('\n');

interface HostProps {
  initial: string;
  /** What "Replace from outside" gives the editor. */
  replacement?: string;
  disabled?: boolean;
  /** Insert text as soon as the handle exists, which is before the editor is ready. */
  insertEarly?: string;
  placeholder?: string;
}

/**
 * A parent of the editor that does what the dialogs do: it holds the value, takes `onChange`, and
 * calls the handle. Its buttons and output let a play function drive and read every contract.
 */
function Host({ initial, replacement, disabled, insertEarly, placeholder }: HostProps) {
  const [value, setValue] = useState(initial);
  const [open, setOpen] = useState(true);
  const [changes, setChanges] = useState(0);
  const [cursor, setCursor] = useState<number | null>(null);
  const [read, setRead] = useState<string | null>(null);
  const handle = useRef<RichMarkdownEditorHandle | null>(null);
  const early = useRef(insertEarly);
  const attach = useCallback((next: RichMarkdownEditorHandle | null) => {
    handle.current = next;
    if (next !== null && early.current !== undefined) {
      next.insert(early.current);
      early.current = undefined;
    }
  }, []);
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => handle.current?.goTo(1)}>
          Go to second heading
        </button>
        <button type="button" onClick={() => handle.current?.insert('Inserted ')}>
          Insert text
        </button>
        <button type="button" onClick={() => setRead(handle.current?.markdown() ?? null)}>
          Read text
        </button>
        <button type="button" onClick={() => setValue(replacement ?? '## Replaced\n')}>
          Replace from outside
        </button>
        <button type="button" onClick={() => setOpen((current) => !current)}>
          {open ? 'Close' : 'Open'}
        </button>
      </div>
      {open && (
        <RichMarkdownEditor
          value={value}
          onChange={(next) => {
            setValue(next);
            setChanges((count) => count + 1);
          }}
          onCursorChange={setCursor}
          aria-label="Description"
          placeholder={placeholder}
          disabled={disabled}
          resolveAttachment={resolveAttachment}
          ref={attach}
        />
      )}
      <output data-testid="changes">{changes}</output>
      <output data-testid="cursor">{cursor ?? 'none'}</output>
      <output data-testid="read">{read ?? 'unread'}</output>
    </div>
  );
}

const meta = {
  title: 'Editor/RichMarkdownEditor',
  component: Host,
  args: { initial: OUTLINE },
} satisfies Meta<typeof Host>;

export default meta;
type Story = StoryObj<typeof meta>;

const editor = (root: HTMLElement) =>
  waitFor(
    () => {
      const found = root.querySelector<HTMLElement>('.ProseMirror');
      expect(found).not.toBeNull();
      return found as HTMLElement;
    },
    { timeout: 10000 },
  );

/** The editor is ready once the document is writable (or marked read-only) and its text is shown. */
const readyEditor = async (root: HTMLElement) => {
  const found = await editor(root);
  await waitFor(() => expect(found.getAttribute('aria-label')).toBe('Description'));
  return found;
};

const output = (root: HTMLElement, id: string) => within(root).getByTestId(id);

export const Empty: Story = {
  args: { initial: '', placeholder: 'Write the description' },
  play: async ({ canvasElement }) => {
    const found = await readyEditor(canvasElement);
    await expect(found.getAttribute('contenteditable')).toBe('true');
    await waitFor(() => expect(canvasElement.querySelector('[data-placeholder]')).not.toBeNull());
    await expect(output(canvasElement, 'changes')).toHaveTextContent('0');
  },
};

/** An untouched body is returned exactly as given, `*` bullets and all, and reports nothing. */
export const Outline: Story = {
  play: async ({ canvasElement }) => {
    await readyEditor(canvasElement);
    await waitFor(() => expect(canvasElement.querySelectorAll('h2')).toHaveLength(3));
    await expect(canvasElement.querySelectorAll('li')).toHaveLength(2);
    await userEvent.click(within(canvasElement).getByText('Read text'));
    await expect(output(canvasElement, 'read').textContent).toBe(OUTLINE);
    await expect(output(canvasElement, 'changes')).toHaveTextContent('0');
  },
};

/** The heading action puts the cursor in Section 2 and reports the offset of that heading's `##`. */
export const LongDocument: Story = {
  args: { initial: LONG },
  play: async ({ canvasElement }) => {
    await readyEditor(canvasElement);
    await waitFor(() => expect(canvasElement.querySelectorAll('h2')).toHaveLength(12));
    await userEvent.click(within(canvasElement).getByText('Go to second heading'));
    await waitFor(() =>
      expect(output(canvasElement, 'cursor')).toHaveTextContent(
        String(LONG.indexOf('## Section 2')),
      ),
    );
    const selected = window.getSelection()?.anchorNode?.parentElement?.closest('h2');
    await expect(selected?.textContent).toBe('Section 2');
  },
};

/** Typing changes the text: it is reported, written back with `-` bullets, and read at once. */
export const EditText: Story = {
  play: async ({ canvasElement }) => {
    const found = await readyEditor(canvasElement);
    await userEvent.click(canvasElement.querySelector('h2') as HTMLElement);
    await userEvent.type(found, 'Typed ');
    await waitFor(() =>
      expect(Number(output(canvasElement, 'changes').textContent)).toBeGreaterThan(0),
    );
    await userEvent.click(within(canvasElement).getByText('Read text'));
    const text = output(canvasElement, 'read').textContent ?? '';
    await expect(text).toContain('Typed');
    await expect(text).toContain('- First');
    await expect(text).not.toContain('* First');
  },
};

/** The handle is used before the editor is ready; the insert waits and applies once it is. */
export const CommandBeforeReady: Story = {
  args: { initial: OUTLINE, insertEarly: 'Early ' },
  play: async ({ canvasElement }) => {
    await readyEditor(canvasElement);
    await waitFor(() =>
      expect(Number(output(canvasElement, 'changes').textContent)).toBeGreaterThan(0),
    );
    await userEvent.click(within(canvasElement).getByText('Read text'));
    await expect(output(canvasElement, 'read').textContent).toContain('Early');
  },
};

export const TableEditing: Story = {
  args: { initial: TABLE },
  play: async ({ canvasElement }) => {
    await readyEditor(canvasElement);
    await waitFor(() => expect(canvasElement.querySelectorAll('td')).toHaveLength(4));
    await userEvent.click(canvasElement.querySelectorAll('td')[3] as HTMLElement);
    await userEvent.keyboard(' extra');
    await waitFor(() =>
      expect(Number(output(canvasElement, 'changes').textContent)).toBeGreaterThan(0),
    );
    await userEvent.click(within(canvasElement).getByText('Read text'));
    await expect(output(canvasElement, 'read').textContent).toMatch(/\| beta\s*\| 2 extra\s*\|/);
  },
};

/** An owned picture is shown; a reference the card does not own shows No image, keeping its title. */
export const Images: Story = {
  args: { initial: IMAGES },
  play: async ({ canvasElement }) => {
    await readyEditor(canvasElement);
    const picture = await waitFor(() => {
      const found = canvasElement.querySelector(`img[src="${SAMPLE_IMAGE_URL}"]`);
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    await expect(picture.getAttribute('alt')).toBe('Found picture');
    await expect(within(canvasElement).getByText('No image')).toBeInTheDocument();
    await userEvent.click(within(canvasElement).getByText('Read text'));
    await expect(output(canvasElement, 'read').textContent).toBe(IMAGES);
  },
};

/** Known languages are highlighted; an unknown one keeps its name and its text, without colors. */
export const CodeLanguages: Story = {
  args: { initial: CODE },
  play: async ({ canvasElement }) => {
    await readyEditor(canvasElement);
    await waitFor(() =>
      expect(canvasElement.querySelectorAll('.milkdown-code-block')).toHaveLength(3),
    );
    await waitFor(() => expect(canvasElement.querySelectorAll('.cm-editor')).toHaveLength(3));
    const blocks = canvasElement.querySelectorAll<HTMLElement>('.milkdown-code-block');
    const [ts, python, unknown] = [blocks[0], blocks[1], blocks[2]] as HTMLElement[];
    await waitFor(() => expect(ts?.querySelectorAll('.cm-line span').length).toBeGreaterThan(0));
    await waitFor(() =>
      expect(python?.querySelectorAll('.cm-line span').length).toBeGreaterThan(0),
    );
    await expect(unknown?.textContent).toContain('unknownlang');
    await expect(unknown?.querySelector('.cm-line')?.textContent).toBe('plain words');
    await expect(unknown?.querySelectorAll('.cm-line span')).toHaveLength(0);
    await userEvent.click(ts as HTMLElement);
    await expect(ts?.getAttribute('data-active')).toBe('true');
    await userEvent.click(python as HTMLElement);
    await expect(ts?.getAttribute('data-active')).toBeNull();
    await expect(output(canvasElement, 'changes')).toHaveTextContent('0');
    await userEvent.click(within(canvasElement).getByText('Read text'));
    await expect(output(canvasElement, 'read').textContent).toContain(
      '```unknownlang\nplain words',
    );
  },
};

export const Diagram: Story = {
  args: { initial: DIAGRAM },
  play: async ({ canvasElement }) => {
    await readyEditor(canvasElement);
    await waitFor(() => expect(canvasElement.querySelector('.rich-mermaid svg')).not.toBeNull(), {
      timeout: 15000,
    });
  },
};

const invalidDiagramAlert = async (canvasElement: HTMLElement) => {
  const alert = await waitFor(
    () => {
      const found = canvasElement.querySelector('.rich-mermaid--error');
      expect(found).not.toBeNull();
      return found as HTMLElement;
    },
    { timeout: 15000 },
  );
  await expect(alert.getAttribute('role')).toBe('alert');
  await expect(alert).toBeVisible();
  return alert;
};

const DIAGRAM_ERROR = {
  en: 'The diagram cannot be drawn: Parse error on line 2:',
  ja: '図を描けません: Parse error on line 2:',
} as const;

/** A wrong diagram shows one line of the error in the page language, and its text is kept. */
export const DiagramInvalid: Story = {
  args: { initial: BROKEN_DIAGRAM },
  globals: { locale: 'en' },
  play: async ({ canvasElement, globals }) => {
    await readyEditor(canvasElement);
    const alert = await invalidDiagramAlert(canvasElement);
    await expect(alert).toHaveTextContent(DIAGRAM_ERROR[globals.locale as 'en' | 'ja']);
    await userEvent.click(within(canvasElement).getByText('Read text'));
    await expect(output(canvasElement, 'read').textContent).toBe(BROKEN_DIAGRAM);
  },
};

/** The same error in Japanese: the sentence comes from the page language, not from the editor. */
export const DiagramInvalidJapanese: Story = {
  args: { initial: BROKEN_DIAGRAM },
  globals: { locale: 'ja' },
  play: async ({ canvasElement, globals }) => {
    await readyEditor(canvasElement);
    const alert = await invalidDiagramAlert(canvasElement);
    await expect(alert).toHaveTextContent(DIAGRAM_ERROR[globals.locale as 'en' | 'ja']);
  },
};

/** A change of the page colors draws the diagram again in the new colors. */
export const DiagramThemeChange: Story = {
  args: { initial: DIAGRAM },
  play: async ({ canvasElement }) => {
    await readyEditor(canvasElement);
    const first = await waitFor(
      () => {
        const found = canvasElement.querySelector('.rich-mermaid');
        expect(found).not.toBeNull();
        return found as HTMLElement;
      },
      { timeout: 15000 },
    );
    const root = document.documentElement;
    const before = root.style.getPropertyValue('--r-accent');
    try {
      root.style.setProperty('--r-accent', '#ff0000');
      await waitFor(
        () => {
          const now = canvasElement.querySelector('.rich-mermaid');
          expect(now).not.toBeNull();
          expect(now).not.toBe(first);
        },
        { timeout: 15000 },
      );
    } finally {
      if (before === '') root.style.removeProperty('--r-accent');
      else root.style.setProperty('--r-accent', before);
    }
  },
};

/** A read-only editor shows the text and refuses typing. */
export const Readonly: Story = {
  args: { disabled: true },
  play: async ({ canvasElement }) => {
    const found = await readyEditor(canvasElement);
    await waitFor(() => expect(found.getAttribute('contenteditable')).toBe('false'));
    await userEvent.click(canvasElement.querySelector('h2') as HTMLElement);
    await userEvent.keyboard('blocked');
    await expect(output(canvasElement, 'changes')).toHaveTextContent('0');
    await userEvent.click(within(canvasElement).getByText('Read text'));
    await expect(output(canvasElement, 'read').textContent).toBe(OUTLINE);
  },
};

/** A new value from outside replaces the session; it is not reported as an edit. */
export const ExternalUpdate: Story = {
  args: { replacement: '## Replaced heading\n\nFrom outside.\n' },
  play: async ({ canvasElement }) => {
    await readyEditor(canvasElement);
    await userEvent.click(within(canvasElement).getByText('Replace from outside'));
    await waitFor(() =>
      expect(within(canvasElement).getByText('Replaced heading')).toBeInTheDocument(),
    );
    await expect(within(canvasElement).queryByText('Goal')).toBeNull();
    await expect(output(canvasElement, 'changes')).toHaveTextContent('0');
    await userEvent.click(within(canvasElement).getByText('Read text'));
    await expect(output(canvasElement, 'read').textContent).toBe(
      '## Replaced heading\n\nFrom outside.\n',
    );
  },
};

/** Closing destroys the editor, and opening it again starts a fresh one with the same text. */
export const CloseAndReopen: Story = {
  args: { initial: DIAGRAM },
  play: async ({ canvasElement }) => {
    await readyEditor(canvasElement);
    await userEvent.click(within(canvasElement).getByText('Close'));
    await waitFor(() => expect(canvasElement.querySelector('.ProseMirror')).toBeNull());
    await userEvent.click(within(canvasElement).getByText('Open'));
    await readyEditor(canvasElement);
    await waitFor(() => expect(canvasElement.querySelector('.rich-mermaid svg')).not.toBeNull(), {
      timeout: 15000,
    });
    await expect(output(canvasElement, 'changes')).toHaveTextContent('0');
  },
};
