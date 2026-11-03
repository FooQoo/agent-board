#!/usr/bin/env node
// Builds the release information of the documentation site from the published
// GitHub Releases, before `pnpm --dir docs build`.
//
// It writes one file under the output folder (default: docs):
//   .vitepress/release.json   the version the site header shows (git-ignored)
//
// Source of the releases (exactly one):
//   --github          the GitHub API of --repo (default FooQoo/agent-board); the
//                     public build uses this. Any API error or invalid release
//                     stops the script and writes nothing, so the last
//                     published site stays as it is.
//   --releases-json F a file in the shape of the GitHub API list (tests)
//   --fixture         the local review copies in releases/*.md, shown as a
//                     fixture and never as a published release
//   --none (default)  no release: the header shows no version
//
// Only releases with draft=false and prerelease=false and a vMAJOR.MINOR.PATCH
// tag count. The version in Cargo.toml is never read.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_REPO = 'FooQoo/agent-board';
const TAG = /^v(\d+)\.(\d+)\.(\d+)$/;

const SECTIONS = {
  en: {
    marker: '## English',
    headings: ['### Changes', '### Fixes', '### Breaking changes', '### Required update steps'],
  },
  ja: {
    marker: '## 日本語',
    headings: ['### 変更点', '### 不具合修正', '### 互換性に影響する変更', '### 必要な更新操作'],
  },
};

function parseArgs(argv) {
  const options = { mode: 'none', repo: DEFAULT_REPO, out: path.join(repoRoot, 'docs'), apiUrl: 'https://api.github.com' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      if (i + 1 >= argv.length) throw new Error(`${arg} needs a value`);
      return argv[++i];
    };
    if (arg === '--github') options.mode = 'github';
    else if (arg === '--fixture') options.mode = 'fixture';
    else if (arg === '--none') options.mode = 'none';
    else if (arg === '--releases-json') (options.mode = 'json'), (options.jsonFile = path.resolve(value()));
    else if (arg === '--repo') options.repo = value();
    else if (arg === '--out') options.out = path.resolve(value());
    else if (arg === '--api-url') options.apiUrl = value().replace(/\/$/, '');
    else throw new Error(`unknown option: ${arg}`);
  }
  if (!/^[\w.-]+\/[\w.-]+$/.test(options.repo)) throw new Error(`invalid --repo: ${options.repo}`);
  return options;
}

async function fetchReleases(options) {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'agent-board-docs-release', 'X-GitHub-Api-Version': '2022-11-28' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const all = [];
  for (let page = 1; page <= 10; page++) {
    const url = `${options.apiUrl}/repos/${options.repo}/releases?per_page=100&page=${page}`;
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`GitHub API answered ${response.status} for ${url}`);
    const batch = await response.json();
    if (!Array.isArray(batch)) throw new Error('GitHub API did not return a list of releases');
    all.push(...batch);
    if (batch.length < 100) return all;
  }
  throw new Error('more than 1000 releases; refusing to guess');
}

// The review copies in releases/*.md stand in for published releases in a fixture preview.
function fixtureReleases(options) {
  const dir = path.join(repoRoot, 'releases');
  return fs
    .readdirSync(dir)
    .filter((name) => /^v\d+\.\d+\.\d+\.md$/.test(name))
    .map((name) => {
      const tag = name.replace(/\.md$/, '');
      return {
        tag_name: tag,
        name: tag,
        body: fs.readFileSync(path.join(dir, name), 'utf8'),
        html_url: `https://github.com/${options.repo}/releases/tag/${tag}`,
        published_at: null,
        draft: false,
        prerelease: false,
      };
    });
}

function splitBody(body, tag) {
  const markers = [SECTIONS.en.marker, SECTIONS.ja.marker];
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const found = {};
  let current = null;
  for (const line of lines) {
    const marker = markers.find((m) => line.trim() === m);
    if (marker) {
      if (found[marker] !== undefined) throw new Error(`${tag}: "${marker}" appears twice`);
      current = marker;
      found[marker] = [];
    } else if (current) found[current].push(line);
  }
  const result = {};
  for (const [lang, spec] of Object.entries(SECTIONS)) {
    const text = (found[spec.marker] ?? []).join('\n').trim();
    if (!text) throw new Error(`${tag}: the ${lang} section "${spec.marker}" is missing or empty`);
    for (const heading of spec.headings) {
      if (!text.split('\n').some((line) => line.trim() === heading)) {
        throw new Error(`${tag}: the ${lang} section has no "${heading}" heading`);
      }
    }
    result[lang] = text;
  }
  return result;
}

// Keeps only published, semver releases, validates them, and sorts newest first.
export function validate(releases, options) {
  const valid = [];
  for (const release of releases) {
    if (release.draft || release.prerelease) continue;
    const match = TAG.exec(String(release.tag_name));
    if (!match) continue;
    const tag = release.tag_name;
    const prefix = `https://github.com/${options.repo}/releases/`;
    if (typeof release.html_url !== 'string' || !release.html_url.startsWith(prefix)) {
      throw new Error(`${tag}: html_url is not a release of ${options.repo}`);
    }
    if (typeof release.body !== 'string') throw new Error(`${tag}: the release has no body`);
    // The body keeps both languages, as the GitHub Release is the release notes.
    splitBody(release.body, tag);
    valid.push({ tag, version: tag.slice(1), parts: match.slice(1).map(Number), url: release.html_url });
  }
  valid.sort((a, b) => b.parts[0] - a.parts[0] || b.parts[1] - a.parts[1] || b.parts[2] - a.parts[2]);
  return valid;
}


function writeHeader(out, header) {
  const file = path.join(out, '.vitepress', 'release.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(header, null, 2)}\n`);
}

export async function build(options) {
  let state = 'published';
  let raw = [];
  if (options.mode === 'github') raw = await fetchReleases(options);
  else if (options.mode === 'json') raw = JSON.parse(fs.readFileSync(options.jsonFile, 'utf8'));
  else if (options.mode === 'fixture') (raw = fixtureReleases(options)), (state = 'fixture');
  const releases = validate(raw, options);
  if (releases.length === 0) state = 'unpublished';
  const latest = releases[0];
  const header = {
    state,
    version: latest ? latest.version : null,
    url: latest ? latest.url : null,
  };
  return { header };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const { header } = await build(options);
    writeHeader(options.out, header);
    console.log(`docs-release: ${header.state}${header.version ? ` v${header.version}` : ''}`);
  } catch (error) {
    console.error(`docs-release: ${error.message}`);
    process.exit(1);
  }
}
