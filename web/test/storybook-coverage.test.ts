import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  COVERAGE_CONFIG,
  compareStoryIds,
  coverageIndex,
  isCoverageFileName,
  isUiPartFile,
  ledgerRows,
  readStoryCoverage,
  uiPartFiles,
  validateStoryCoverage,
} from '../.storybook/support/coverage';

const SRC = join(import.meta.dirname, '../src');

/** A minimal valid entry for `shared/ui/button.tsx`, changed per test. */
function entry(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    owner: 'U1',
    file: 'shared/ui/button.tsx',
    exports: [
      {
        name: 'Button',
        stories: [{ id: 'shared-ui-button--default', states: ['default'], interaction: false }],
      },
    ],
    ...overrides,
  };
}

describe('story coverage configuration', () => {
  it('names the layers, the coverage file and the story suffix the collector uses', () => {
    expect(COVERAGE_CONFIG.collect.uiLayers).toEqual(['app', 'pages', 'features', 'shared']);
    expect(isCoverageFileName('story-coverage.json')).toBe(true);
    expect(isCoverageFileName('story-coverage.dialog.json')).toBe(true);
    expect(isCoverageFileName('coverage.json')).toBe(false);
    expect(COVERAGE_CONFIG.collect.storyFileSuffix).toBe('.stories.tsx');
    expect(COVERAGE_CONFIG.inventory.status).toBe('partial');
  });

  it('counts product UI parts only, not stories, tests or declarations', () => {
    expect(isUiPartFile('shared/ui/button.tsx')).toBe(true);
    expect(isUiPartFile('features/tasks/status/StatusLabel.tsx')).toBe(true);
    expect(isUiPartFile('shared/ui/button.stories.tsx')).toBe(false);
    expect(isUiPartFile('shared/ui/button.test.tsx')).toBe(false);
    expect(isUiPartFile('shared/types.d.ts')).toBe(false);
    expect(isUiPartFile('lib/util.tsx')).toBe(false);
    expect(isUiPartFile('shared/api/contracts.ts')).toBe(true);
  });

  it('lists the UI part files the collector walks, and no story file', () => {
    const parts = uiPartFiles(SRC);
    expect(parts).toContain('shared/ui/button.tsx');
    expect(parts.some((path) => path.endsWith('.stories.tsx'))).toBe(false);
    expect(parts.every((path) => isUiPartFile(path))).toBe(true);
  });
});

describe('story coverage files in the product', () => {
  it('match the coverage format, and every listed part exists', () => {
    const { files, problems } = readStoryCoverage(SRC);
    expect(problems).toEqual([]);
    expect(files.length).toBeGreaterThanOrEqual(6);
    expect(ledgerRows(files).length).toBeGreaterThan(0);
  });

  it('build the index a generated report reads', () => {
    const { files } = readStoryCoverage(SRC);
    const index = coverageIndex(files);
    expect(index['shared/ui/button.tsx']?.Button?.storyIds).toContain('shared-ui-button--default');
    expect(index['shared/ui/button.tsx']?.buttonVariants?.exclusion).toMatch(/class helper/);
  });
});

describe('story coverage validation', () => {
  it('accepts a complete entry', () => {
    expect(validateStoryCoverage(entry(), SRC)).toEqual([]);
  });

  it('accepts an export with an exclusion reason and no Story', () => {
    const value = entry({
      exports: [
        {
          name: 'Button',
          stories: [],
          exclusion: 'Rendered only by its parents, which own the Story.',
        },
      ],
    });
    expect(validateStoryCoverage(value, SRC)).toEqual([]);
  });

  it('gives a named coverage file only the source of its name', () => {
    const value = entry({
      file: 'shared/ui/dialog.tsx',
      exports: [
        {
          name: 'Dialog',
          stories: [{ id: 'shared-ui-dialog--open', states: ['open'], interaction: false }],
        },
      ],
    });
    expect(validateStoryCoverage(value, SRC, 'story-coverage.dialog.json')).toEqual([]);
    expect(validateStoryCoverage(value, SRC, 'story-coverage.json')).toEqual([]);
    const wrong = validateStoryCoverage(entry(), SRC, 'story-coverage.dialog.json');
    expect(wrong.join('\n')).toContain(
      'may only cover button.tsx or button.ts, not shared/ui/button.tsx',
    );
  });

  it('refuses a story or test file as the covered part', () => {
    const problems = validateStoryCoverage(entry({ file: 'shared/ui/button.stories.tsx' }), SRC);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('not a story or test');
  });

  it('refuses a file outside the UI layers', () => {
    expect(
      validateStoryCoverage(entry({ file: '../.storybook/support/fixtures.ts' }), SRC)[0],
    ).toContain('not a story or test');
  });

  it('refuses an export the file does not declare', () => {
    const value = entry({
      exports: [
        {
          name: 'Missing',
          stories: [{ id: 'shared-ui-missing--default', states: ['x'], interaction: false }],
        },
      ],
    });
    expect(validateStoryCoverage(value, SRC).join('\n')).toContain(
      'is not exported by shared/ui/button.tsx',
    );
  });

  it('refuses an ID outside the configured Storybook form', () => {
    const value = entry({
      exports: [
        {
          name: 'Button',
          stories: [{ id: 'Shared/UI/Button--Default', states: ['x'], interaction: false }],
        },
      ],
    });
    expect(validateStoryCoverage(value, SRC).join('\n')).toContain('invalid story ID');
  });

  it('refuses a duplicate ID inside one file', () => {
    const story = { id: 'shared-ui-button--default', states: ['x'], interaction: false };
    const value = entry({ exports: [{ name: 'Button', stories: [story, story] }] });
    expect(validateStoryCoverage(value, SRC).join('\n')).toContain('duplicate story ID');
  });

  it('refuses a part with neither a Story nor a long enough reason', () => {
    const value = entry({ exports: [{ name: 'Button', stories: [], exclusion: 'short' }] });
    expect(validateStoryCoverage(value, SRC).join('\n')).toContain(
      `neither a Story nor an exclusion reason of ${COVERAGE_CONFIG.entry.exclusionMinLength}+`,
    );
  });

  it('refuses a Story that lists no states or no interaction flag', () => {
    const value = entry({
      exports: [{ name: 'Button', stories: [{ id: 'shared-ui-button--default', states: [] }] }],
    });
    const problems = validateStoryCoverage(value, SRC).join('\n');
    expect(problems).toContain('lists no states');
    expect(problems).toContain('must say whether it has an interaction');
  });

  it('refuses a part that lists both Stories and an exclusion', () => {
    const value = entry({
      exports: [
        {
          name: 'Button',
          stories: [{ id: 'shared-ui-button--default', states: ['x'], interaction: false }],
          exclusion: 'Both at once, which is not allowed.',
        },
      ],
    });
    expect(validateStoryCoverage(value, SRC).join('\n')).toContain('choose one');
  });
});

describe('comparison with the Story IDs Storybook registers', () => {
  const { files } = readStoryCoverage(SRC);

  it('reports a registered Story no file lists, and a listed ID nobody registers', () => {
    const result = compareStoryIds(files, ['shared-ui-button--default', 'shared-ui-new--story']);
    expect(result.missing).toEqual(['shared-ui-new--story']);
    expect(result.unknown).toContain('task-status-statuslabel--card-todo');
  });

  it('reports nothing when the lists match', () => {
    const ids = ledgerRows(files).flatMap((row) => (row.storyId ? [row.storyId] : []));
    expect(compareStoryIds(files, ids)).toEqual({ missing: [], unknown: [] });
  });
});
