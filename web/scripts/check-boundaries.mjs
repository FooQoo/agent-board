// Checks the layer rules of `web/src` and reports import cycles.
//
// Layers, from top to bottom: app, pages, features, shared. A file may import a file in its own
// feature or page, or in a lower layer. `shared` imports nothing above itself, one feature never
// imports another, and one page never imports another. Static imports, `import type`, re-exports
// and `import()` are all followed, so a type-only or lazy reference does not hide a dependency.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const LAYERS = ['app', 'pages', 'features', 'shared'];
// The Storybook support sits above the layers, for development only: stories and tests may import it,
// and product code may not.
const SUPPORT = '.storybook/';
const STORY_OR_TEST = /\.(stories|test)\.tsx?$/;
const EXTENSIONS = ['', '.ts', '.tsx', '.css', '.json', '/index.ts', '/index.tsx'];
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*)(['"])([^'"\n]+)\1/g;

/** The code of a source file without comments, so a quoted path in a comment is not an import. */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** `{ layer, slice }` of a path under `src/` (`slice` names the feature or page), or null. */
export function placeOf(path) {
  const [layer, slice] = path.replace(/^src\//, '').split('/');
  if (!LAYERS.includes(layer)) return null;
  return { layer, slice: layer === 'pages' || layer === 'features' ? slice : '' };
}

/** The rule a dependency from `from` to `to` breaks, or null when it is allowed. */
export function violation(from, to) {
  const a = placeOf(from);
  const b = placeOf(to);
  if (!a) return `${from} is not in a layer folder`;
  if (!b) return `${to} is not in a layer folder`;
  const up = LAYERS.indexOf(b.layer) < LAYERS.indexOf(a.layer);
  if (up) return `${a.layer} must not import ${b.layer}`;
  if (a.layer === b.layer && a.slice !== b.slice)
    return `${a.layer}/${a.slice} must not import ${b.layer}/${b.slice}`;
  return null;
}

// `shared/data` is loaded at start-up, so it stays free of the heavy rendering libraries and of the
// rich editor; they load only when a screen needs them.
const DATA_FOLDER = 'src/shared/data/';
const HEAVY_FOR_DATA = ['src/shared/rich-editor/'];
const HEAVY_PACKAGES = ['mermaid', 'react-markdown'];

/** The rule a file under `shared/data` breaks by importing `spec` (a package) or `target` (a file). */
export function dataViolation(from, spec, target) {
  if (!from.startsWith(DATA_FOLDER)) return null;
  if (target && HEAVY_FOR_DATA.some((folder) => target.startsWith(folder)))
    return 'shared/data must not import the rich editor';
  const heavy = HEAVY_PACKAGES.find((name) => spec === name || spec.startsWith(`${name}/`));
  return heavy ? `shared/data must not import ${heavy}` : null;
}

/** Files that `source` imports, as paths under `src/` that exist in `files`. */
export function importsOf(source, text, files) {
  const found = [];
  for (const [, , spec] of stripComments(text).matchAll(SPECIFIER)) {
    if (!spec.startsWith('.') && !spec.startsWith('@/')) continue;
    const base = spec.startsWith('@/')
      ? `src/${spec.slice(2)}`
      : posix.normalize(posix.join(posix.dirname(source), spec));
    const target = EXTENSIONS.map((ext) => base + ext).find((path) => files.has(path));
    if (target) found.push(target);
    else found.push(`${base} (missing)`);
  }
  return found;
}

/** Strongly connected groups of more than one file in the import graph. */
export function cycles(graph) {
  let counter = 0;
  const index = new Map();
  const low = new Map();
  const onStack = new Set();
  const stack = [];
  const groups = [];
  const visit = (node) => {
    index.set(node, counter);
    low.set(node, counter);
    counter += 1;
    stack.push(node);
    onStack.add(node);
    for (const next of graph.get(node) ?? []) {
      if (!graph.has(next)) continue;
      if (!index.has(next)) {
        visit(next);
        low.set(node, Math.min(low.get(node), low.get(next)));
      } else if (onStack.has(next)) low.set(node, Math.min(low.get(node), index.get(next)));
    }
    if (low.get(node) !== index.get(node)) return;
    const group = [];
    let member;
    do {
      member = stack.pop();
      onStack.delete(member);
      group.push(member);
    } while (member !== node);
    if (group.length > 1 || (graph.get(node) ?? []).includes(node)) groups.push(group.sort());
  };
  for (const node of graph.keys()) if (!index.has(node)) visit(node);
  return groups;
}

/** All problems in `sources` (path under `web/` to text), as printable lines. */
export function analyze(sources) {
  const files = new Set(Object.keys(sources));
  const problems = [];
  const graph = new Map();
  for (const [path, text] of Object.entries(sources)) {
    if (!/\.(ts|tsx)$/.test(path) || path.startsWith(SUPPORT)) continue;
    const targets = importsOf(path, text, files);
    graph.set(path, []);
    for (const [, , spec] of stripComments(text).matchAll(SPECIFIER)) {
      const broken = dataViolation(path, spec, null);
      if (broken) problems.push(`${path}: imports ${spec}: ${broken}`);
    }
    for (const target of targets) {
      if (target.endsWith('(missing)')) {
        problems.push(`${path}: cannot resolve ${target}`);
        continue;
      }
      if (target.startsWith(SUPPORT)) {
        if (!STORY_OR_TEST.test(path)) {
          problems.push(
            `${path}: imports ${target}: only stories and tests may use Storybook support`,
          );
        }
        continue;
      }
      if (/\.(ts|tsx)$/.test(target)) graph.get(path).push(target);
      const broken = violation(path, target) ?? dataViolation(path, '', target);
      if (broken) problems.push(`${path}: imports ${target}: ${broken}`);
    }
  }
  for (const group of cycles(graph)) problems.push(`import cycle: ${group.join(' -> ')}`);
  return problems;
}

function readTree(root, dir, into) {
  for (const name of readdirSync(join(root, dir))) {
    const path = posix.join(dir, name);
    if (statSync(join(root, path)).isDirectory()) readTree(root, path, into);
    else into[path] = readFileSync(join(root, path), 'utf8');
  }
  return into;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  if (!existsSync(join(root, 'src'))) throw new Error('web/src is missing.');
  const problems = analyze(readTree(root, '.storybook', readTree(root, 'src', {})));
  for (const line of problems) console.error(line);
  console.log(`Checked the import boundaries of web/src: ${problems.length} problem(s).`);
  process.exit(problems.length === 0 ? 0 : 1);
}
