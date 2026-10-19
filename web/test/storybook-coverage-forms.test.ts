import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  compareStoryIds,
  coverageSources,
  ledgerRows,
  readStoryCoverage,
  type StoryCoverageDocument,
  validateStoryCoverage,
} from '../.storybook/support/coverage';

const SRC = join(import.meta.dirname, '../src');
const SHARED_UI = { name: 'story-coverage.json', location: 'shared/ui' };

const story = (id: string) => ({ id, states: ['shown'], interaction: false });

/** Two sibling PascalCase components in one folder: the case that one lowercase ledger must cover. */
const SIBLINGS: Record<string, string> = {
  'shared/ui/EpicBadge.tsx': 'export function EpicBadge() {\n  return null;\n}\n',
  'shared/ui/EpicLabel.tsx': 'export function EpicLabel() {\n  return null;\n}\n',
  'shared/ui/EpicBadge.stories.tsx':
    "export default { title: 'Epic/Label/EpicBadge' };\n\nexport const Default = {};\n",
  'shared/ui/EpicLabel.stories.tsx':
    "export default { title: 'Epic/Label/EpicLabel' };\n\nexport const Default = {};\n\nexport const Disabled = {};\n",
};

const roots: string[] = [];

/** A temporary source tree, so the reader can be tested on real files. */
function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'u1-coverage-forms-'));
  roots.push(root);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('single-source coverage (legacy form, unchanged)', () => {
  it('still covers one file with one owner', () => {
    const value: StoryCoverageDocument = {
      schemaVersion: 1,
      owner: 'U10',
      file: 'shared/ui/button.tsx',
      exports: [{ name: 'Button', stories: [story('shared-ui-button--default')] }],
    };
    expect(validateStoryCoverage(value, SRC, SHARED_UI)).toEqual([]);
    expect(coverageSources(value)).toEqual([
      {
        file: 'shared/ui/button.tsx',
        owner: 'U10',
        exports: value.exports,
      },
    ]);
  });

  it('still names a single-source ledger story-coverage.<name>.json for its own file', () => {
    const value: StoryCoverageDocument = {
      schemaVersion: 1,
      owner: 'U10',
      file: 'shared/ui/dialog.tsx',
      exports: [{ name: 'Dialog', stories: [story('shared-ui-dialog--open')] }],
    };
    expect(
      validateStoryCoverage(value, SRC, {
        name: 'story-coverage.dialog.json',
        location: 'shared/ui',
      }),
    ).toEqual([]);
    expect(
      validateStoryCoverage(value, SRC, {
        name: 'story-coverage.button.json',
        location: 'shared/ui',
      }).join('\n'),
    ).toContain('may only cover dialog.tsx or dialog.ts');
  });
});

describe('multi-source coverage (one story-coverage.json for several files)', () => {
  const value: StoryCoverageDocument = {
    schemaVersion: 1,
    owner: 'U10',
    files: [
      {
        file: 'shared/ui/button.tsx',
        exports: [{ name: 'Button', stories: [story('shared-ui-button--default')] }],
      },
      {
        file: 'shared/ui/dialog.tsx',
        owner: 'U11',
        exports: [{ name: 'Dialog', stories: [story('shared-ui-dialog--open')] }],
      },
    ],
  };

  it('accepts several sources in one folder under one lowercase name', () => {
    expect(validateStoryCoverage(value, SRC, SHARED_UI)).toEqual([]);
  });

  it('gives each source its own owner, and the document owner when a source names none', () => {
    expect(coverageSources(value).map(({ file, owner }) => [file, owner])).toEqual([
      ['shared/ui/button.tsx', 'U10'],
      ['shared/ui/dialog.tsx', 'U11'],
    ]);
    const rows = ledgerRows([value]);
    expect(rows.find((row) => row.file === 'shared/ui/button.tsx')?.owner).toBe('U10');
    expect(rows.find((row) => row.file === 'shared/ui/dialog.tsx')?.owner).toBe('U11');
    expect(rows.every((row) => row.storyId !== null)).toBe(true);
  });

  it('compares the registered Story IDs across every source of the document', () => {
    expect(
      compareStoryIds([value], ['shared-ui-button--default', 'shared-ui-dialog--open']),
    ).toEqual({ missing: [], unknown: [] });
    expect(
      compareStoryIds([value], ['shared-ui-button--default', 'shared-ui-dialog--trigger']),
    ).toEqual({ missing: ['shared-ui-dialog--trigger'], unknown: ['shared-ui-dialog--open'] });
  });

  it('must be named story-coverage.json', () => {
    expect(
      validateStoryCoverage(value, SRC, {
        name: 'story-coverage.dialog.json',
        location: 'shared/ui',
      }).join('\n'),
    ).toContain('lists several sources, so it must be named story-coverage.json');
  });

  it('refuses a document with both file and files, or with neither', () => {
    expect(
      validateStoryCoverage({ ...value, file: 'shared/ui/button.tsx' }, SRC, SHARED_UI).join('\n'),
    ).toContain('use either file (one source) or files (several sources), not both');
    const neither = { schemaVersion: 1, owner: 'U10' };
    expect(validateStoryCoverage(neither, SRC, SHARED_UI).join('\n')).toContain(
      'name the covered sources in file (one) or files (several)',
    );
  });

  it('refuses a source listed twice', () => {
    const twice = { ...value, files: [value.files[0], value.files[0]] };
    expect(validateStoryCoverage(twice, SRC, SHARED_UI).join('\n')).toContain(
      'shared/ui/button.tsx is listed twice in files',
    );
  });

  it('refuses a source owner that is not a unit identifier', () => {
    const dialog = value.files.find((entry) => entry.file === 'shared/ui/dialog.tsx');
    if (!dialog) throw new Error('dialog fixture is missing');
    const bad = {
      ...value,
      files: [{ ...dialog, owner: 'dialog-owner' }],
    };
    expect(validateStoryCoverage(bad, SRC, SHARED_UI).join('\n')).toContain(
      'shared/ui/dialog.tsx: owner must match ^U\\d+$',
    );
  });

  it('refuses a source that is not beside the coverage file, and says which folder it belongs to', () => {
    const elsewhere = {
      ...value,
      files: [
        {
          file: 'features/tasks/status/StatusLabel.tsx',
          exports: [
            { name: 'StatusLabel', stories: [story('task-status-statuslabel--card-todo')] },
          ],
        },
      ],
    };
    expect(validateStoryCoverage(elsewhere, SRC, SHARED_UI).join('\n')).toContain(
      'story-coverage.json is in shared/ui but covers features/tasks/status/StatusLabel.tsx; a coverage file must sit beside the part it covers (features/tasks/status)',
    );
  });

  it('refuses a Story that the folder does not register, for any listed source', () => {
    const missing = {
      ...value,
      files: [
        {
          file: 'shared/ui/button.tsx',
          exports: [{ name: 'Button', stories: [story('shared-ui-button--nowhere')] }],
        },
      ],
    };
    expect(validateStoryCoverage(missing, SRC, SHARED_UI).join('\n')).toContain(
      'shared-ui-button--nowhere is not registered by a .stories.tsx file in shared/ui',
    );
  });
});

describe('sibling PascalCase components on disk', () => {
  it('are covered by one story-coverage.json, each with its own owner', () => {
    const root = tree({
      ...SIBLINGS,
      'shared/ui/story-coverage.json': JSON.stringify({
        schemaVersion: 1,
        owner: 'U10',
        files: [
          {
            file: 'shared/ui/EpicBadge.tsx',
            exports: [{ name: 'EpicBadge', stories: [story('epic-label-epicbadge--default')] }],
          },
          {
            file: 'shared/ui/EpicLabel.tsx',
            owner: 'U11',
            exports: [
              {
                name: 'EpicLabel',
                stories: [
                  story('epic-label-epiclabel--default'),
                  story('epic-label-epiclabel--disabled'),
                ],
              },
            ],
          },
        ],
      }),
    });
    const { files, problems } = readStoryCoverage(root);
    expect(problems).toEqual([]);
    expect(files).toHaveLength(1);
    const rows = ledgerRows(files);
    expect(rows.find((row) => row.file === 'shared/ui/EpicBadge.tsx')?.owner).toBe('U10');
    expect(rows.find((row) => row.file === 'shared/ui/EpicLabel.tsx')?.owner).toBe('U11');
    expect(
      compareStoryIds(files, [
        'epic-label-epicbadge--default',
        'epic-label-epiclabel--default',
        'epic-label-epiclabel--disabled',
      ]),
    ).toEqual({ missing: [], unknown: [] });
  });

  it('reports a registered Story that no listed source covers', () => {
    const root = tree({
      ...SIBLINGS,
      'shared/ui/story-coverage.json': JSON.stringify({
        schemaVersion: 1,
        owner: 'U10',
        files: [
          {
            file: 'shared/ui/EpicLabel.tsx',
            exports: [{ name: 'EpicLabel', stories: [story('epic-label-epiclabel--default')] }],
          },
        ],
      }),
    });
    const { files, problems } = readStoryCoverage(root);
    expect(problems).toEqual([]);
    expect(
      compareStoryIds(files, ['epic-label-epicbadge--default', 'epic-label-epiclabel--default'])
        .missing,
    ).toEqual(['epic-label-epicbadge--default']);
  });

  it('refuses a source covered by two coverage documents, and names both', () => {
    // A lowercase source, since the single-source name rule needs one: dialog.tsx.
    const root = tree({
      'shared/ui/dialog.tsx': 'export function Dialog() {\n  return null;\n}\n',
      'shared/ui/dialog.stories.tsx':
        "export default { title: 'Shared/UI/Dialog' };\n\nexport const Open = {};\n",
      'shared/ui/story-coverage.json': JSON.stringify({
        schemaVersion: 1,
        owner: 'U10',
        files: [
          {
            file: 'shared/ui/dialog.tsx',
            exports: [{ name: 'Dialog', stories: [story('shared-ui-dialog--open')] }],
          },
        ],
      }),
      'shared/ui/story-coverage.dialog.json': JSON.stringify({
        schemaVersion: 1,
        owner: 'U10',
        file: 'shared/ui/dialog.tsx',
        exports: [{ name: 'Dialog', stories: [story('shared-ui-dialog--open')] }],
      }),
    });
    const { problems } = readStoryCoverage(root);
    expect(problems).toEqual([
      'shared/ui/story-coverage.json: shared/ui/dialog.tsx is already covered by shared/ui/story-coverage.dialog.json',
    ]);
  });

  it('refuses a PascalCase source under the single-source name rule, which needs a lowercase name', () => {
    const root = tree({
      ...SIBLINGS,
      'shared/ui/story-coverage.epicbadge.json': JSON.stringify({
        schemaVersion: 1,
        owner: 'U10',
        file: 'shared/ui/EpicBadge.tsx',
        exports: [{ name: 'EpicBadge', stories: [story('epic-label-epicbadge--default')] }],
      }),
    });
    const { problems } = readStoryCoverage(root);
    expect(problems.join('\n')).toContain(
      'story-coverage.epicbadge.json may only cover EpicBadge.tsx or EpicBadge.ts, not shared/ui/EpicBadge.tsx',
    );
  });

  it('reports a PascalCase ledger name instead of skipping it', () => {
    const root = tree({
      ...SIBLINGS,
      'shared/ui/story-coverage.EpicBadge.json': JSON.stringify({
        schemaVersion: 1,
        owner: 'U10',
        file: 'shared/ui/EpicBadge.tsx',
        exports: [{ name: 'EpicBadge', stories: [story('epic-label-epicbadge--default')] }],
      }),
    });
    // Reported, not skipped: otherwise EpicBadge would go unchecked without any sign.
    const { files, problems } = readStoryCoverage(root);
    expect(files).toEqual([]);
    expect(problems).toEqual([
      'shared/ui/story-coverage.EpicBadge.json: not a coverage file name; use story-coverage.json, or story-coverage.<lowercase-name>.json for a single source',
    ]);
  });
});
