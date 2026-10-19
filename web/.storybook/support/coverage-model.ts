// The format and collection settings of the story coverage ledger, and the rules that need no file
// system. The Node tests and the browser check both use this module, so they read one definition.

import config from './component-coverage.json' with { type: 'json' };

export interface CoverageConfig {
  schemaVersion: 1;
  description: string;
  collect: {
    sourceRoot: string;
    uiLayers: string[];
    coverageFilePattern: string;
    coverageFileNaming: string;
    placement: string;
    storyFileSuffix: string;
    excludedFileSuffixes: string[];
  };
  entry: {
    storyIdPattern: string;
    exportNamePattern: string;
    exclusionMinLength: number;
    storyIdRule: string;
    ownerPattern: string;
    ownerRule: string;
  };
  inventory: { status: string; owner: string; method: string };
  completeness: { gate: string; nodeCheckLimit: string };
  storyOwnership: { seed: string; after: string; u1Scope: string };
}

export const COVERAGE_CONFIG = config as CoverageConfig;

const COVERAGE_FILE = new RegExp(COVERAGE_CONFIG.collect.coverageFilePattern);

/** Whether a file name is a coverage file: `story-coverage.json` or `story-coverage.<name>.json`. */
export function isCoverageFileName(name: string): boolean {
  return COVERAGE_FILE.test(name);
}

/**
 * The part name a coverage file name carries: `story-coverage.json` carries none (it covers the
 * folder's first file), and `story-coverage.dialog.json` carries `dialog`.
 */
export function coverageNamePart(name: string): string | null {
  const match = /^story-coverage\.([a-z0-9-]+)\.json$/.exec(name);
  return match?.[1] ?? null;
}

export interface StoryCoverageStory {
  /** The Storybook story ID, as `toId(meta.title, storyNameFromExport(exportName))` gives it. */
  id: string;
  /** The states the Story shows, such as `empty`, `saving` or `failed`. */
  states: string[];
  /** Whether a play function drives a real interaction (a click, typing or a keyboard step). */
  interaction: boolean;
}

export interface StoryCoverageExport {
  /** The exported UI part, as the file names it. */
  name: string;
  /** The Stories that show the part. Empty only when `exclusion` gives the reason. */
  stories: StoryCoverageStory[];
  /** Why the part has no Story of its own, such as "rendered only inside its parent". */
  exclusion?: string;
}

/**
 * A coverage document that covers one source file. This is the original form, and it is still valid:
 * the file is `story-coverage.json` or `story-coverage.<name>.json`.
 */
export interface StoryCoverageFile {
  schemaVersion: 1;
  /** The unit that owns this file. */
  owner: string;
  /** The product file the exports come from, relative to the source root. */
  file: string;
  exports: StoryCoverageExport[];
}

/** One source inside a multi-source document. Its owner overrides the document owner when present. */
export interface StoryCoverageSourceEntry {
  /** The product file the exports come from, relative to the source root. */
  file: string;
  /** The unit that owns this source, when it differs from the document owner. */
  owner?: string;
  exports: StoryCoverageExport[];
}

/**
 * A coverage document that covers several sources in its own folder, as PascalCase sibling components
 * need. It is always named `story-coverage.json`.
 */
export interface StoryCoverageSourceList {
  schemaVersion: 1;
  /** The default owner of the sources that do not name their own. */
  owner: string;
  files: StoryCoverageSourceEntry[];
}

export type StoryCoverageDocument = StoryCoverageFile | StoryCoverageSourceList;

/** One source with its owner resolved, whichever document form it came from. */
export interface StoryCoverageSource {
  file: string;
  owner: string;
  exports: StoryCoverageExport[];
}

/** The sources a coverage document covers, each with its owner resolved. */
export function coverageSources(document: StoryCoverageDocument): StoryCoverageSource[] {
  if ('files' in document) {
    return document.files.map((entry) => ({
      file: entry.file,
      owner: entry.owner ?? document.owner,
      exports: entry.exports,
    }));
  }
  return [{ file: document.file, owner: document.owner, exports: document.exports }];
}

/** Whether a source path (relative to the source root) is a UI part the ledger covers. */
export function isUiPartFile(file: string): boolean {
  const { uiLayers, excludedFileSuffixes } = COVERAGE_CONFIG.collect;
  const [layer] = file.split('/');
  if (!layer || !uiLayers.includes(layer)) return false;
  if (!/\.tsx?$/.test(file)) return false;
  return !excludedFileSuffixes.some((suffix) => file.endsWith(suffix));
}

export interface LedgerRow {
  file: string;
  /** The unit that owns the source file, as the source's own or the document's owner. */
  owner: string;
  part: string;
  storyId: string | null;
  states: string[];
  interaction: boolean;
}

/** One row per Story for the ledger: the file, its owner, the part, the Story ID, states and interaction. */
export function ledgerRows(documents: StoryCoverageDocument[]): LedgerRow[] {
  const rows: LedgerRow[] = [];
  for (const document of documents) {
    for (const source of coverageSources(document)) {
      for (const item of source.exports) {
        if (item.stories.length === 0) {
          rows.push({
            file: source.file,
            owner: source.owner,
            part: item.name,
            storyId: null,
            states: [],
            interaction: false,
          });
        }
        for (const story of item.stories) {
          rows.push({
            file: source.file,
            owner: source.owner,
            part: item.name,
            storyId: story.id,
            states: story.states,
            interaction: story.interaction,
          });
        }
      }
    }
  }
  return rows;
}

export interface CoveragePart {
  storyIds: string[];
  exclusion: string | null;
}

/** The index a generated report reads: file, then part, then its Story IDs or its exclusion. */
export function coverageIndex(
  documents: StoryCoverageDocument[],
): Record<string, Record<string, CoveragePart>> {
  const index: Record<string, Record<string, CoveragePart>> = {};
  for (const document of documents) {
    for (const source of coverageSources(document)) {
      const parts: Record<string, CoveragePart> = {};
      for (const item of source.exports) {
        parts[item.name] = {
          storyIds: item.stories.map((story) => story.id),
          exclusion: item.exclusion?.trim() || null,
        };
      }
      index[source.file] = parts;
    }
  }
  return index;
}

/**
 * Compares the Story IDs in the coverage files with the IDs Storybook registers. `missing` are
 * registered Stories no file lists; `unknown` are listed IDs Storybook does not register.
 */
export function compareStoryIds(
  documents: StoryCoverageDocument[],
  registeredIds: readonly string[],
): { missing: string[]; unknown: string[] } {
  const listed = new Set(
    ledgerRows(documents).flatMap((row) => (row.storyId ? [row.storyId] : [])),
  );
  const registered = new Set(registeredIds);
  return {
    missing: [...registered].filter((id) => !listed.has(id)).sort(),
    unknown: [...listed].filter((id) => !registered.has(id)).sort(),
  };
}
