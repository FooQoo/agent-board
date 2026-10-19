import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(import.meta.dirname, '../src');
// The stylesheets that were the old src/styles folder, now beside the code they style.
const files = [
  'shared/styles/app.css',
  'pages/archive/archive.css',
  'features/tasks/card/card-answer.css',
  'features/tasks/answer/decision-request.css',
  'features/tasks/detail/detail.css',
  'features/epics/editor/editor-epic.css',
  'shared/styles/editor.css',
  'pages/epics/epics.css',
  'shared/styles/lightbox.css',
  'shared/styles/list-pane.css',
  'shared/markdown/markdown.css',
  'shared/styles/modal.css',
  'shared/styles/resize.css',
  'shared/styles/rich-body.css',
  'shared/styles/rich-table.css',
  'shared/styles/theme.css',
  'shared/styles/tokens.css',
  'shared/styles/ui.css',
];

describe('typography', () => {
  it('uses the app font tokens, not named document faces', () => {
    for (const name of files) {
      const css = readFileSync(join(SRC, name), 'utf8');
      expect(css, name).not.toMatch(/Noto (Sans|Serif) JP|IBM Plex Mono/);
    }
  });

  it('has no chapter number chip or oversized headings in the editor body', () => {
    const css = files.map((name) => readFileSync(join(SRC, name), 'utf8')).join('\n');
    expect(css).not.toContain('md-chapter__number');
    expect(css).not.toContain('counter(chapter');
    expect(css).not.toMatch(/font-size: (31|35|23|32|17)px/);
  });
});
