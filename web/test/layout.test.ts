// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

/** The declarations of the first rule whose selector list contains `selector` exactly. */
function rule(css: string, selector: string): string {
  const pattern = new RegExp(
    `(?:^|\\})\\s*(?:[^{}]*,\\s*)?${selector.replace(/[.[\]()]/g, '\\$&')}\\s*(?:,[^{}]*)?\\{([^}]*)\\}`,
    'm',
  );
  const match = css.match(pattern);
  if (!match?.[1]) throw new Error(`missing rule ${selector}`);
  return match[1];
}

describe('desktop layout', () => {
  const css = read('src/shared/styles/app.css');

  it('stacks the header, the body and the status bar to the full viewport height', () => {
    expect(rule(css, '.app')).toMatch(/height:\s*100svh/);
    expect(rule(css, '.header')).toMatch(/height:\s*56px/);
    expect(rule(css, '.header')).toMatch(/padding:\s*0 24px/);
    expect(rule(css, '.app')).toMatch(/grid-template-rows:\s*56px minmax\(0, 1fr\) 40px/);
    expect(rule(css, '.status-bar')).toMatch(/padding:\s*0 24px/);
  });

  it('puts the board and the detail column side by side with the stored detail width', () => {
    expect(rule(css, '.app__body')).toContain(
      'grid-template-columns: minmax(0, 1fr) var(--detail-width)',
    );
  });

  it('uses the same board padding, lane gap and lane padding at every width', () => {
    expect(rule(css, '.board__lanes')).toMatch(/padding:\s*24px/);
    expect(rule(css, '.board__lanes')).toMatch(/gap:\s*16px/);
    expect(rule(css, '.board__lanes')).toMatch(
      /grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/,
    );
    expect(rule(css, '.lane')).toMatch(/padding:\s*12px/);
    expect(rule(css, '.lane')).toMatch(/border-radius:\s*var\(--radius-lane\)/);
  });

  it('draws the detail column with a left border, 28px padding and a scrolling tab content', () => {
    const detail = rule(css, '.detail');
    expect(detail).toMatch(/padding:\s*28px/);
    expect(detail).toMatch(/border-left:\s*1px solid var\(--r-border\)/);
    expect(detail).toMatch(/gap:\s*18px/);
    const viewport = rule(read('src/features/tasks/detail/detail.css'), '.detail__viewport');
    expect(viewport).toMatch(/overflow-y:\s*auto/);
  });
});

describe('dialogs and sheets with a software keyboard', () => {
  // 100dvh follows the visible area, which a tablet's keyboard shrinks, so a dialog sized by it
  // is squashed while you type. The small viewport (svh) stays put when the keyboard opens.
  const sheets = [
    'src/shared/styles/modal.css',
    'src/shared/styles/editor.css',
    'src/features/tasks/answer/decision-answer.css',
    'src/features/tasks/acceptance/conditions-dock.css',
    'src/features/docs/ui/shell/docs-shell.css',
    'src/features/onboarding/ui/onboarding.css',
  ];

  it.each(sheets)('%s sizes its dialogs by the small viewport, not the dynamic one', (path) => {
    expect(read(path)).not.toMatch(/\d+dvh/);
  });
});

describe('touch screens', () => {
  const ui = read('src/shared/styles/ui.css');
  const app = read('src/shared/styles/app.css');

  it('grows the S and M buttons to 44px on a coarse pointer only', () => {
    const block = ui.match(/@media \(pointer: coarse\) \{\s*:root \{([^}]*)\}/g)?.join('\n') ?? '';
    expect(block).toMatch(/--btn-s-h:\s*var\(--btn-l-h\)/);
    expect(block).toMatch(/--btn-s-icon:\s*var\(--btn-l-icon\)/);
    expect(block).toMatch(/--btn-m-h:\s*var\(--btn-l-h\)/);
    expect(rule(ui, ':root')).toMatch(/--btn-s-h:\s*30px/);
  });

  it('keeps double-tap zoom off and controls from being selected by a long press', () => {
    expect(app).toMatch(/\nhtml \{\s*touch-action:\s*manipulation/);
    expect(rule(app, 'button')).toMatch(/user-select:\s*none/);
    expect(rule(app, 'button')).toMatch(/-webkit-touch-callout:\s*none/);
  });

  it('keeps the board still behind a scrolling dialog', () => {
    expect(rule(read('src/shared/styles/modal.css'), '.modal')).toMatch(
      /overscroll-behavior:\s*contain/,
    );
  });

  it('gives the small hit areas a larger touch area on a coarse pointer', () => {
    expect(app).toMatch(/@media \(pointer: coarse\)[\s\S]*\.card__epic::after/);
    expect(read('src/shared/styles/resize.css')).toMatch(
      /@media \(pointer: coarse\)[\s\S]*\.resize-handle::after/,
    );
    expect(read('src/features/tasks/detail/detail.css')).toMatch(
      /@media \(pointer: coarse\)[\s\S]*\.detail__tablist/,
    );
  });

  it('lets the card header and the answer button wrap in a narrow lane', () => {
    expect(rule(app, '.card__top')).toMatch(/flex-wrap:\s*wrap/);
    expect(
      rule(read('src/features/tasks/answer/decision-answer.css'), '.decision-answer-button'),
    ).toMatch(/white-space:\s*normal/);
  });
});
