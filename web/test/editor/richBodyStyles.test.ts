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
