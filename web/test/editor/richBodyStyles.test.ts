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
    const shell = readFileSync(join(SRC, 'components/editor/EditorShell.tsx'), 'utf8');
    expect(shell).toContain("'../../styles/rich-body.css'");
    const css = readFileSync(join(SRC, 'styles/rich-body.css'), 'utf8');
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
    const css = readFileSync(join(SRC, 'styles/rich-body.css'), 'utf8');
    expect(css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
    expect(css).toContain('var(--r-accent)');
    expect(css).toContain('var(--r-surface)');
    expect(css).toContain('var(--r-border)');
  });
});

describe('focus frames and code block headers', () => {
  const read = (name: string) => readFileSync(join(SRC, 'styles', name), 'utf8');

  it('the title shows no frame while it is edited, only the caret', () => {
    const css = read('editor-epic.css');
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
