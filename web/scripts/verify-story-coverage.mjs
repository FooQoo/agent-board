import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { API } from 'typescript/unstable/sync';

const root = path.resolve(import.meta.dirname, '..');
const sourceRoot = path.join(root, 'src');
const configPath = path.join(root, '.storybook/support/component-coverage.json');
const tsconfigPath = path.join(root, 'tsconfig.json');
const staticIndexPath = path.join(root, 'storybook-static/index.json');
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const errors = [];
const componentExclusions = new Map();
for (const entry of config.collect.componentSourceExclusions ?? []) {
  if (
    !entry ||
    typeof entry.file !== 'string' ||
    typeof entry.reason !== 'string' ||
    entry.reason.trim().length < config.entry.exclusionMinLength
  ) {
    errors.push('componentSourceExclusions entries need a source file and a meaningful reason');
    continue;
  }
  if (componentExclusions.has(entry.file))
    errors.push(`${entry.file}: duplicate component exclusion`);
  componentExclusions.set(entry.file, entry.reason.trim());
}

function walk(directory, relative = '') {
  const files = [];
  for (const name of readdirSync(path.join(directory, relative)).sort()) {
    const child = path.posix.join(relative, name);
    const absolute = path.join(directory, child);
    if (statSync(absolute).isDirectory()) files.push(...walk(directory, child));
    else files.push(child);
  }
  return files;
}

function isUiSource(file) {
  const [layer] = file.split('/');
  return (
    config.collect.uiLayers.includes(layer) &&
    /\.tsx?$/.test(file) &&
    !config.collect.excludedFileSuffixes.some((suffix) => file.endsWith(suffix))
  );
}

function fail(message) {
  errors.push(message);
}

function isComponentExport(symbol, file, sourceText) {
  if (symbol.name === 'default') {
    return /export\s+default\s+(?:async\s+)?function\s+[A-Z]/.test(sourceText);
  }
  if (!/^[A-Z]/.test(symbol.name)) return false;
  const hasValueDeclaration = Boolean(symbol.valueDeclaration);
  const valueSymbolFlags = 16 | 32 | 1 | 2; // function, class, function-scoped and block-scoped values
  const hasValueFlag = (symbol.flags & valueSymbolFlags) !== 0;
  const isAllCapsConstant = /^[A-Z][A-Z0-9_]*$/.test(symbol.name);
  return (
    hasValueDeclaration &&
    hasValueFlag &&
    !isAllCapsConstant &&
    file.endsWith('.tsx') &&
    /<(?:[a-z][a-z0-9-]*|[A-Z][A-Za-z0-9.]*)[\s>]/.test(sourceText)
  );
}

const api = new API();
api.parseConfigFile(tsconfigPath);
const snapshot = api.updateSnapshot({ openProjects: [tsconfigPath] });
const project = snapshot.getProject(tsconfigPath);
if (!project) fail(`TypeScript could not open ${tsconfigPath}`);
const exportedParts = new Map();
if (project) {
  const programFiles = new Set(project.rootFiles.map((file) => path.resolve(file)));
  for (const file of walk(sourceRoot).filter(isUiSource)) {
    if (componentExclusions.has(file)) continue;
    const absolute = path.resolve(sourceRoot, file);
    if (!programFiles.has(absolute)) {
      fail(`${file}: TypeScript project did not include this UI source`);
      continue;
    }
    const source = project.program.getSourceFile(absolute);
    if (!source) {
      fail(`${file}: TypeScript program could not load this UI source`);
      continue;
    }
    const moduleSymbol = project.checker.getSymbolAtLocation(source);
    if (!moduleSymbol) continue;
    const exports = project.checker.getExportsOfModule(moduleSymbol);
    const sourceText = readFileSync(absolute, 'utf8');
    const names = exports
      .filter((symbol) => isComponentExport(symbol, file, sourceText))
      .map((symbol) => symbol.name)
      .sort();
    if (names.length === 0) continue;
    exportedParts.set(file, new Set(names));
  }
}

const coverageFiles = walk(sourceRoot).filter((file) =>
  new RegExp(config.collect.coverageFilePattern).test(path.posix.basename(file)),
);
const coverage = new Map();
const listedStoryIds = new Set();
for (const relative of coverageFiles) {
  const absolute = path.join(sourceRoot, relative);
  let document;
  try {
    document = JSON.parse(readFileSync(absolute, 'utf8'));
  } catch (error) {
    fail(`${relative}: invalid JSON (${error.message})`);
    continue;
  }
  const entries = Array.isArray(document.files)
    ? document.files.map((entry) => ({ ...entry, owner: entry.owner ?? document.owner }))
    : [document];
  for (const entry of entries) {
    if (typeof entry.file !== 'string' || !Array.isArray(entry.exports)) {
      fail(`${relative}: expected a source file and exports array`);
      continue;
    }
    if (!isUiSource(entry.file)) {
      fail(`${relative}: ${entry.file} is outside the configured UI source set`);
      continue;
    }
    if (coverage.has(entry.file)) {
      fail(`${entry.file}: covered by more than one ledger`);
      continue;
    }
    const names = new Set();
    for (const part of entry.exports) {
      if (!part || typeof part.name !== 'string') {
        fail(`${entry.file}: coverage entry has no export name`);
        continue;
      }
      if (names.has(part.name)) fail(`${entry.file}: ${part.name} is listed more than once`);
      names.add(part.name);
      const stories = Array.isArray(part.stories) ? part.stories : [];
      const exclusion = typeof part.exclusion === 'string' ? part.exclusion.trim() : '';
      if (stories.length === 0 && exclusion.length < config.entry.exclusionMinLength) {
        fail(`${entry.file}#${part.name}: missing a Story or a meaningful exclusion reason`);
      }
      if (stories.length > 0 && part.exclusion !== undefined) {
        fail(`${entry.file}#${part.name}: cannot list both Stories and an exclusion`);
      }
      for (const story of stories) {
        if (typeof story?.id !== 'string') {
          fail(`${entry.file}#${part.name}: story has no ID`);
          continue;
        }
        listedStoryIds.add(story.id);
      }
    }
    coverage.set(entry.file, names);
  }
}

for (const [file, exports] of exportedParts) {
  const entries = coverage.get(file);
  if (!entries) {
    fail(`${file}: no adjacent coverage entry for exports: ${[...exports].join(', ')}`);
    continue;
  }
  for (const name of exports)
    if (!entries.has(name)) fail(`${file}#${name}: missing from coverage`);
}
let storyIndex;
try {
  storyIndex = JSON.parse(readFileSync(staticIndexPath, 'utf8'));
} catch {
  fail('web/storybook-static/index.json is missing; build Storybook before running this check');
}
if (storyIndex) {
  const indexedStoryIds = new Set(
    Object.entries(storyIndex.entries ?? {})
      .filter(([, entry]) => entry.type === 'story')
      .map(([id]) => id),
  );
  for (const id of listedStoryIds)
    if (!indexedStoryIds.has(id)) fail(`coverage references unknown Story ID ${id}`);
  for (const id of indexedStoryIds)
    if (!listedStoryIds.has(id)) fail(`Storybook story ${id} is missing from coverage`);
}

if (errors.length > 0) {
  console.error(`Story coverage verification failed (${errors.length} issue(s)):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

snapshot.dispose();
api.close();

console.log(
  `Story coverage verified: ${exportedParts.size} UI source files, ${[...exportedParts.values()].reduce((sum, names) => sum + names.size, 0)} exports, ${listedStoryIds.size} Story IDs.`,
);
