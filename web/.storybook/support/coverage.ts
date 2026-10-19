// The format of the story coverage files. Each UI folder keeps a `story-coverage.json` beside the
// parts it covers. It lists every exported UI part of its file, the Stories that show it, and the
// states those Stories show. A part with no Story of its own states the reason instead.
//
// Only the format lives here. The owning unit writes the data, and the coverage test checks it.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';

export const STORY_COVERAGE_FILE = 'story-coverage.json';

export interface StoryCoverageStory {
  /** The Storybook story ID: `<title in kebab case>--<story export in kebab case>`. */
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

export interface StoryCoverageFile {
  schemaVersion: 1;
  /** The unit that owns this file. */
  owner: string;
  /** The product file the exports come from, relative to `web/src`. */
  file: string;
  exports: StoryCoverageExport[];
}

const STORY_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*--[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EXPORT_NAME = /^[A-Za-z][A-Za-z0-9]*$/;

/** Whether `text` exports `name` as a declaration or in an export list. */
function exports(text: string, name: string): boolean {
  const declared = new RegExp(
    `export\\s+(?:default\\s+)?(?:function|const|class|let)\\s+${name}\\b`,
  );
  const listed = new RegExp(`export\\s*(?:type\\s*)?\\{[^}]*\\b${name}\\b[^}]*\\}`);
  return declared.test(text) || listed.test(text);
}

/** Every problem in one coverage file, as printable lines. `srcRoot` is the absolute `web/src`. */
export function validateStoryCoverage(value: unknown, srcRoot: string): string[] {
  const problems: string[] = [];
  const file = value as Partial<StoryCoverageFile>;
  if (typeof file !== 'object' || file === null) return ['the file is not an object'];
  if (file.schemaVersion !== 1) problems.push('schemaVersion must be 1');
  if (typeof file.owner !== 'string' || file.owner === '') problems.push('owner is missing');
  if (typeof file.file !== 'string' || !/\.tsx?$/.test(file.file)) {
    problems.push('file must name a .ts or .tsx source under src');
    return problems;
  }
  const path = join(srcRoot, file.file);
  if (!existsSync(path)) {
    problems.push(`${file.file} does not exist`);
    return problems;
  }
  const text = readFileSync(path, 'utf8');
  if (!Array.isArray(file.exports) || file.exports.length === 0) {
    problems.push(`${file.file}: exports must list at least one part`);
    return problems;
  }
  const seenIds = new Set<string>();
  for (const item of file.exports) {
    const label = `${file.file}#${item.name}`;
    if (typeof item.name !== 'string' || !EXPORT_NAME.test(item.name)) {
      problems.push(`${file.file}: invalid export name ${String(item.name)}`);
      continue;
    }
    if (!exports(text, item.name)) problems.push(`${label} is not exported by ${file.file}`);
    const stories = Array.isArray(item.stories) ? item.stories : [];
    const reason = typeof item.exclusion === 'string' ? item.exclusion.trim() : '';
    if (stories.length === 0 && reason === '') {
      problems.push(`${label} has neither a Story nor an exclusion reason`);
    }
    if (stories.length > 0 && item.exclusion !== undefined) {
      problems.push(`${label} lists Stories and an exclusion; choose one`);
    }
    for (const story of stories) {
      if (typeof story.id !== 'string' || !STORY_ID.test(story.id)) {
        problems.push(`${label}: invalid story ID ${String(story.id)}`);
      } else if (seenIds.has(story.id)) {
        problems.push(`${label}: duplicate story ID ${story.id}`);
      } else seenIds.add(story.id);
      if (!Array.isArray(story.states) || story.states.length === 0) {
        problems.push(`${label}: ${String(story.id)} lists no states`);
      }
      if (typeof story.interaction !== 'boolean') {
        problems.push(`${label}: ${String(story.id)} must say whether it has an interaction`);
      }
    }
  }
  return problems;
}

/** Every `story-coverage.json` under a folder, as absolute paths, in a stable order. */
export function findStoryCoverage(dir: string, into: string[] = []): string[] {
  for (const name of readdirSync(dir).sort()) {
    const path = posix.join(dir, name);
    if (statSync(path).isDirectory()) findStoryCoverage(path, into);
    else if (name === STORY_COVERAGE_FILE) into.push(path);
  }
  return into;
}

export interface LedgerRow {
  file: string;
  part: string;
  storyId: string | null;
  states: string[];
  interaction: boolean;
}

/** One row per Story for the ledger: the file, the part, the Story ID, its states and interaction. */
export function ledgerRows(files: StoryCoverageFile[]): LedgerRow[] {
  const rows: LedgerRow[] = [];
  for (const file of files) {
    for (const item of file.exports) {
      if (item.stories.length === 0) {
        rows.push({
          file: file.file,
          part: item.name,
          storyId: null,
          states: [],
          interaction: false,
        });
      }
      for (const story of item.stories) {
        rows.push({
          file: file.file,
          part: item.name,
          storyId: story.id,
          states: story.states,
          interaction: story.interaction,
        });
      }
    }
  }
  return rows;
}

/** Reads and reports every coverage file under `srcRoot`. */
export function readStoryCoverage(srcRoot: string): {
  files: StoryCoverageFile[];
  problems: string[];
} {
  const files: StoryCoverageFile[] = [];
  const problems: string[] = [];
  for (const path of findStoryCoverage(srcRoot)) {
    const value = JSON.parse(readFileSync(path, 'utf8'));
    const found = validateStoryCoverage(value, srcRoot);
    for (const line of found) problems.push(`${posix.relative(srcRoot, path)}: ${line}`);
    if (found.length === 0) files.push(value as StoryCoverageFile);
  }
  return { files, problems };
}
