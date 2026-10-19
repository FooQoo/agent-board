import { isExportStory, storyNameFromExport, toId } from 'storybook/internal/csf';
import { describe, expect, it } from 'vitest';
import { COVERAGE_CONFIG, compareStoryIds, type StoryCoverageFile } from './coverage-model';

// Every story module and coverage file of the product, loaded by Vite in the browser.
const storyModules = import.meta.glob<Record<string, unknown> & { default: { title?: string } }>(
  '../../src/**/*.stories.tsx',
  { eager: true },
);
const coverageModules = import.meta.glob<StoryCoverageFile>('../../src/**/story-coverage*.json', {
  eager: true,
  import: 'default',
});

/** The IDs Storybook registers for the modules: `toId(title, storyNameFromExport(export))`. */
function registeredStoryIds(): string[] {
  return Object.values(storyModules).flatMap((module) => {
    const meta = module.default;
    if (typeof meta.title !== 'string') throw new Error('a story module has no title');
    return (
      Object.keys(module)
        // The default export is the meta, not a Story; isExportStory alone would accept it.
        .filter((key) => key !== 'default' && isExportStory(key, meta as never))
        .map((key) => toId(meta.title as string, storyNameFromExport(key)))
    );
  });
}

describe('story IDs against the coverage files', () => {
  const coverage = Object.values(coverageModules);

  it('reads the story modules and the coverage files', () => {
    expect(Object.keys(storyModules).length).toBeGreaterThanOrEqual(6);
    expect(coverage.length).toBeGreaterThanOrEqual(6);
  });

  it('registers exactly the Story IDs the coverage files list', () => {
    const registered = registeredStoryIds();
    expect(new Set(registered).size).toBe(registered.length);
    expect(compareStoryIds(coverage, registered)).toEqual({ missing: [], unknown: [] });
  });

  it('gives every registered ID the form the configuration requires', () => {
    const pattern = new RegExp(COVERAGE_CONFIG.entry.storyIdPattern);
    for (const id of registeredStoryIds()) expect(id, id).toMatch(pattern);
  });
});
