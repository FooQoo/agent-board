// File-system side of the story coverage ledger: finds and validates the coverage files under the
// source root. The format and the rules come from coverage-model.ts and component-coverage.json.
//
// Limit: this Node check validates the Story IDs that coverage files list, and where they sit. It cannot
// see a Story that no coverage file lists. The formal completeness gate is `pnpm --dir web test:storybook`,
// whose storybook-support project compares the registered Story IDs with the coverage files in both
// directions (see component-coverage.json, "completeness").

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';
import { storyNameFromExport, toId } from 'storybook/internal/csf';
import {
  COVERAGE_CONFIG,
  coverageNamePart,
  isCoverageFileName,
  isUiPartFile,
  type StoryCoverageFile,
} from './coverage-model.ts';

export * from './coverage-model.ts';

/** Every UI part file under `srcRoot`, relative to it, in a stable order. */
export function uiPartFiles(srcRoot: string, dir = '', into: string[] = []): string[] {
  for (const name of readdirSync(join(srcRoot, dir)).sort()) {
    const path = posix.join(dir, name);
    if (statSync(join(srcRoot, path)).isDirectory()) uiPartFiles(srcRoot, path, into);
    else if (isUiPartFile(path)) into.push(path);
  }
  return into;
}

/** Whether `text` exports `name` as a declaration or in an export list. */
function exportsName(text: string, name: string): boolean {
  const declared = new RegExp(
    `export\\s+(?:default\\s+)?(?:function|const|class|let)\\s+${name}\\b`,
  );
  const listed = new RegExp(`export\\s*(?:type\\s*)?\\{[^}]*\\b${name}\\b[^}]*\\}`);
  return declared.test(text) || listed.test(text);
}

/** Where a coverage file is: its name, and its folder relative to the source root. */
export interface CoveragePlacement {
  name: string;
  location: string;
}

/**
 * The Story IDs that the `*.stories.tsx` files of one folder register, computed as Storybook computes
 * them: `toId(title, storyNameFromExport(export))`.
 */
export function storyIdsBeside(
  srcRoot: string,
  location: string,
): { ids: string[]; storyFiles: string[] } {
  const suffix = COVERAGE_CONFIG.collect.storyFileSuffix;
  const dir = join(srcRoot, location);
  const storyFiles = existsSync(dir)
    ? readdirSync(dir)
        .filter((n) => n.endsWith(suffix))
        .sort()
    : [];
  const ids: string[] = [];
  for (const name of storyFiles) {
    const text = readFileSync(join(dir, name), 'utf8');
    const title = /title:\s*['"]([^'"]+)['"]/.exec(text)?.[1];
    if (!title) continue;
    for (const match of text.matchAll(/^export const ([A-Za-z][A-Za-z0-9]*)\b/gm)) {
      ids.push(toId(title, storyNameFromExport(match[1] ?? '')));
    }
  }
  return { ids, storyFiles };
}

/**
 * Every problem in one coverage file, as printable lines. `srcRoot` is the absolute source root. The
 * file must sit beside the part it covers, its name sets the part it may cover, and every Story ID it
 * lists must be registered by a Story file in that same folder.
 */
export function validateStoryCoverage(
  value: unknown,
  srcRoot: string,
  placement: CoveragePlacement,
): string[] {
  const { storyIdPattern, exportNamePattern, exclusionMinLength, ownerPattern } =
    COVERAGE_CONFIG.entry;
  const storyId = new RegExp(storyIdPattern);
  const exportName = new RegExp(exportNamePattern);
  const problems: string[] = [];
  const file = value as Partial<StoryCoverageFile>;
  if (typeof file !== 'object' || file === null) return ['the file is not an object'];
  if (file.schemaVersion !== 1) problems.push('schemaVersion must be 1');
  if (typeof file.owner !== 'string' || !new RegExp(ownerPattern).test(file.owner)) {
    problems.push(`owner must match ${ownerPattern}, such as U10 (the unit the inventory assigns)`);
  }
  if (typeof file.file !== 'string' || !isUiPartFile(file.file)) {
    problems.push(
      `file must name a UI part under ${COVERAGE_CONFIG.collect.uiLayers.join(', ')} (not a story or test)`,
    );
    return problems;
  }
  const path = join(srcRoot, file.file);
  if (!existsSync(path)) {
    problems.push(`${file.file} does not exist`);
    return problems;
  }
  const expectedLocation = posix.dirname(file.file);
  if (placement.location !== expectedLocation) {
    problems.push(
      `${placement.name} is in ${placement.location || '.'} but covers ${file.file}; a coverage file must sit beside the part it covers (${expectedLocation})`,
    );
  }
  const part = coverageNamePart(placement.name);
  const sourceName = posix.basename(file.file).replace(/\.tsx?$/, '');
  if (part !== null && part !== sourceName) {
    problems.push(
      `${placement.name} may only cover ${sourceName}.tsx or ${sourceName}.ts, not ${file.file}`,
    );
  }
  const beside = storyIdsBeside(srcRoot, placement.location);
  const text = readFileSync(path, 'utf8');
  if (!Array.isArray(file.exports) || file.exports.length === 0) {
    problems.push(`${file.file}: exports must list at least one part`);
    return problems;
  }
  const seenNames = new Set<string>();
  for (const item of file.exports) {
    // One Story may show several parts of the file, so an ID may repeat across parts but not within one.
    const seenIds = new Set<string>();
    const label = `${file.file}#${String(item?.name)}`;
    if (typeof item.name !== 'string' || !exportName.test(item.name)) {
      problems.push(`${file.file}: invalid export name ${String(item.name)}`);
      continue;
    }
    if (seenNames.has(item.name)) problems.push(`${label} is listed twice`);
    seenNames.add(item.name);
    if (!exportsName(text, item.name)) problems.push(`${label} is not exported by ${file.file}`);
    const stories = Array.isArray(item.stories) ? item.stories : [];
    const reason = typeof item.exclusion === 'string' ? item.exclusion.trim() : '';
    if (stories.length === 0 && reason.length < exclusionMinLength) {
      problems.push(
        `${label} has neither a Story nor an exclusion reason of ${exclusionMinLength}+ characters`,
      );
    }
    if (stories.length > 0 && item.exclusion !== undefined) {
      problems.push(`${label} lists Stories and an exclusion; choose one`);
    }
    for (const story of stories) {
      if (typeof story.id !== 'string' || !storyId.test(story.id)) {
        problems.push(`${label}: invalid story ID ${String(story.id)}`);
      } else if (seenIds.has(story.id)) {
        problems.push(`${label}: duplicate story ID ${story.id}`);
      } else seenIds.add(story.id);
      if (typeof story.id === 'string' && !beside.ids.includes(story.id)) {
        problems.push(
          `${label}: ${story.id} is not registered by a ${COVERAGE_CONFIG.collect.storyFileSuffix} file in ${placement.location || '.'} (${beside.storyFiles.length} such file(s) there)`,
        );
      }
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

/** Every coverage file under a folder, as absolute paths, in a stable order. */
export function findStoryCoverage(dir: string, into: string[] = []): string[] {
  for (const name of readdirSync(dir).sort()) {
    const path = posix.join(dir, name);
    if (statSync(path).isDirectory()) findStoryCoverage(path, into);
    else if (isCoverageFileName(name)) into.push(path);
  }
  return into;
}

/** Reads and validates every coverage file under `srcRoot`. */
export function readStoryCoverage(srcRoot: string): {
  files: StoryCoverageFile[];
  problems: string[];
} {
  const files: StoryCoverageFile[] = [];
  const problems: string[] = [];
  for (const path of findStoryCoverage(srcRoot)) {
    const value = JSON.parse(readFileSync(path, 'utf8'));
    const placement = {
      name: posix.basename(path),
      location: posix.relative(srcRoot, posix.dirname(path)),
    };
    const found = validateStoryCoverage(value, srcRoot, placement);
    for (const line of found) problems.push(`${posix.relative(srcRoot, path)}: ${line}`);
    if (found.length === 0) files.push(value as StoryCoverageFile);
  }
  return { files, problems };
}
