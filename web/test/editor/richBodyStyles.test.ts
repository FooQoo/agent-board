import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(import.meta.dirname, '../../src');

function sourcesIn(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(ts|tsx|css)$/.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name));
}

describe('rich body styling', () => {
  it('never imports the Crepe theme stylesheets', () => {
    for (const file of sourcesIn(SRC)) {
      const text = readFileSync(file, 'utf8');
      expect({ file, imports: /crepe\/theme/.test(text) }).toEqual({ file, imports: false });
    }
  });

  it('is loaded with the editor dialogs and styles the parts Crepe draws', () => {
    const shell = readFileSync(join(SRC, 'shared/ui/editor/EditorShell.tsx'), 'utf8');
    expect(shell).toContain("'../../styles/rich-body.css'");
    const css = readFileSync(join(SRC, 'shared/styles/rich-body.css'), 'utf8');
    for (const selector of [
      '.rich-markdown .milkdown-toolbar',
      '.rich-markdown .milkdown-toolbar .toolbar-item',
      '.rich-markdown .milkdown-link-edit',
      '.rich-markdown .link-edit .input-area',
      '.rich-markdown .milkdown-list-item-block',
      '.rich-markdown .milkdown-list-item-block .label-wrapper .checked',
      '.rich-markdown .milkdown-list-item-block .label-wrapper .unchecked',
    ]) {
      expect(css, selector).toContain(selector);
    }
  });

  it('takes every color from the app tokens, as the reading view does', () => {
    const css = readFileSync(join(SRC, 'shared/styles/rich-body.css'), 'utf8');
    expect(css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
    expect(css).toContain('var(--r-accent)');
    expect(css).toContain('var(--r-surface)');
    expect(css).toContain('var(--r-border)');
  });
});

describe('focus frames and code block headers', () => {
  const read = (name: string) => readFileSync(join(SRC, 'shared/styles', name), 'utf8');

  it('the title shows no frame while it is edited, only the caret', () => {
    const css = readFileSync(join(SRC, 'features/epics/editor/editor-epic.css'), 'utf8');
    const start = css.indexOf('.editor__input--title:focus');
    expect(start).toBeGreaterThan(-1);
    const block = css.slice(start, css.indexOf('}', start));
    expect(block).toContain('outline: none');
    expect(block).toContain('box-shadow: none');
    expect(block).not.toMatch(/outline: [^n]/);
  });

  it('the code block header is hidden until the block is focused or selected', () => {
    const css = read('rich-body.css');
    expect(css).toMatch(/\.milkdown-code-block \.tools \{[^}]*display: none/);
    expect(css).toContain('.milkdown-code-block:focus-within .tools');
    expect(css).toContain('.milkdown-code-block.selected .tools');
  });

  it('the header is one compact row: the language at the left, the buttons at the right', () => {
    const css = read('rich-body.css');
    expect(css).toMatch(/\.milkdown-code-block \.tools \{[^}]*justify-content: space-between/);
    expect(css).toMatch(/\.tools-button-group button \{[^}]*opacity: 1/);
  });
});

describe('table block controls', () => {
  const css = readFileSync(join(SRC, 'shared/styles/rich-table.css'), 'utf8');

  it('keeps the handles out of the flow and hidden until the table is used', () => {
    for (const selector of [
      '.rich-markdown .milkdown-table-block .handle',
      '.rich-markdown .milkdown-table-block .handle[data-show="false"]',
      '.rich-markdown .milkdown-table-block .cell-handle .button-group',
      '.rich-markdown .milkdown-table-block .cell-handle .button-group[data-show="false"]',
      '.rich-markdown .milkdown-table-block .drag-preview[data-show="false"]',
    ]) {
      expect(css, selector).toContain(selector);
    }
    const start = css.indexOf('.rich-markdown .milkdown-table-block .handle {');
    expect(css.slice(start, css.indexOf('}', start))).toContain('position: absolute');
  });
});

describe('code block current line', () => {
  it('shows no wash that would lower the text contrast', () => {
    const css = readFileSync(join(SRC, 'shared/styles/rich-body.css'), 'utf8');
    const start = css.indexOf('.rich-markdown .milkdown-code-block .cm-activeLine,');
    expect(start).toBeGreaterThan(-1);
    expect(css.slice(start, css.indexOf('}', start))).toContain('background: transparent');
  });
});
