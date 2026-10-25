#!/usr/bin/env node
// Writes the large benchmark data area used by measure.mjs.
//
// The output is an AGBOARD_HOME directory: `shared/` holds one project with 300 cards
// and 10 epics, written in the documented file format. Every value comes from a fixed
// seed and a fixed clock, so two runs with the same seed write the same bytes.
//
// Usage: node scripts/bench/gen-fixture.mjs --out <empty-dir> [--seed <integer>]
// Prints one JSON object with the file count, the byte total, and a digest of every file.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_SEED = 20261022;
export const PROJECT_NAME = 'Bench';
export const TASK_COUNT = 300;
export const EPIC_COUNT = 10;
/** Every sixth card has a history of HISTORY_ENTRIES entries; that is 50 cards. */
export const HISTORY_STRIDE = 6;
export const HISTORY_ENTRIES = 100;
/** Cards 6, 12 and 18 carry the 50,000-character body, the images, and the diagrams. */
export const HEAVY_TASK_IDS = [6, 12, 18];
export const IMAGES_PER_HEAVY_TASK = 10;
export const MERMAID_PER_HEAVY_TASK = [7, 7, 6];
/** Epics 1 and 2 carry a 50,000-character document. */
export const LONG_EPIC_COUNT = 2;
export const BODY_LIMIT = 50_000;

const BASE_MS = Date.parse('2026-10-01T00:00:00Z');
const MINUTE_MS = 60_000;
// The smallest valid PNG (1 x 1); every attachment stores this image.
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgaPj/HwAEggJ/59habAAAAABJRU5ErkJggg==';
const WORDS = [
  'board', 'lane', 'card', 'epic', 'history', 'archive', 'monitor', 'snapshot', 'render', 'query',
  'cache', 'status', 'column', 'draft', 'summary', 'detail', 'markdown', 'table', 'diagram', 'image',
  'reader', 'writer', 'version', 'pending', 'answer', 'project', 'folder', 'agent', 'session', 'entry',
];

/** A small, fully deterministic PRNG (mulberry32). */
export function createRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad = (value, width) => String(value).padStart(width, '0');
const isoAt = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z');
const hex = (random, digits) => Array.from({ length: digits }, () => Math.floor(random() * 16).toString(16)).join('');
const pick = (random, items) => items[Math.floor(random() * items.length)];

function sentence(random, words) {
  const text = Array.from({ length: words }, () => pick(random, WORDS)).join(' ');
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

/** Section text for the long documents: a heading, paragraphs, a table, nested lists, and a code fence. */
function longSection(random, label, index, image, mermaidNumber) {
  const n = index + 1;
  const lines = [
    `## ${label} section ${n}`,
    '',
    sentence(random, 30),
    sentence(random, 26),
    '',
    '| Column A | Column B | Column C |',
    '| --- | --- | --- |',
    `| row ${n}-1 | ${Math.floor(random() * 100000)} | ${sentence(random, 3)} |`,
    `| row ${n}-2 | ${Math.floor(random() * 100000)} | ${sentence(random, 3)} |`,
    `| row ${n}-3 | ${Math.floor(random() * 100000)} | ${sentence(random, 3)} |`,
    '',
    '- Level one item',
    '  - Level two item',
    '    - Level three item',
    '      - Level four item',
    '',
    '```ts',
    `export function step${n}(input: number): number {`,
    `  return input * ${n} + ${Math.floor(random() * 1000)};`,
    '}',
    '```',
    '',
  ];
  if (image) lines.push(`![Figure ${n}](assets/${image}.png)`, '');
  if (mermaidNumber !== undefined) {
    lines.push('```mermaid', 'graph TD', `  A${n}[Start ${n}] --> B${n}[Finish ${n}]`, '```', '');
  }
  return `${lines.join('\n')}\n`;
}

/**
 * A Markdown body of exactly BODY_LIMIT characters. Whole sections are added until the text
 * is close to the limit; plain text fills the rest, so no code fence is left open.
 */
export function longBody(random, label, images = [], mermaidCount = 0, mermaidStart = 10) {
  const parts = [];
  let length = 0;
  for (let index = 0; length < BODY_LIMIT - 4000; index++) {
    const mermaidNumber = index >= mermaidStart && index - mermaidStart < mermaidCount ? index : undefined;
    const text = longSection(random, label, index, images[index], mermaidNumber);
    parts.push(text);
    length += text.length;
  }
  const head = parts.join('');
  const unit = 'Closing note: this section is plain text that ends the fixture body. ';
  const need = BODY_LIMIT - head.length;
  if (need < 0) throw new Error(`sections are ${-need} characters over the limit`);
  const body = head + unit.repeat(Math.ceil(need / unit.length) + 1).slice(0, need);
  if (body.length !== BODY_LIMIT) throw new Error(`long body is ${body.length} characters, not ${BODY_LIMIT}`);
  return body;
}

function shortBody(random, index, lane, position) {
  const lines = [
    `Body of Bench task ${pad(index, 3)}. ${sentence(random, 18)}`,
    '',
    `- ${sentence(random, 6)}`,
    `  - ${sentence(random, 5)}`,
    `    - ${sentence(random, 4)}`,
    `- ${sentence(random, 6)}`,
    '',
    '| Field | Value |',
    '| --- | --- |',
    `| owner | ${pick(random, WORDS)} |`,
    `| size | ${Math.floor(random() * 50)} |`,
  ];
  if (index % 5 === 0) lines.push('', '```text', `lane ${lane} position ${position}`, '```');
  return `${lines.join('\n')}\n`;
}

/** The `history` frontmatter of TASK.md. Reasons are written as JSON strings, which YAML also reads. */
function historyFrontmatter(events) {
  if (events.length === 0) return 'history: []';
  const lines = ['history:'];
  for (const event of events) {
    lines.push(`  - at: ${JSON.stringify(event.at)}`, `    reason: ${JSON.stringify(event.reason)}`);
  }
  return lines.join('\n');
}

function taskMarkdown(body, events) {
  return `---\nacceptance: []\n${historyFrontmatter(events)}\n---\n\n${body}`;
}

function jsonFile(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function touch(file, iso) {
  const at = new Date(iso);
  utimesSync(file, at, at);
}

/**
 * Writes the fixture into `out`, which must not exist yet or must be empty.
 * Returns the summary that the command prints.
 */
export function generateFixture(out, seed = DEFAULT_SEED) {
  if (existsSync(out) && readdirSync(out).length > 0) throw new Error(`${out} is not empty`);
  mkdirSync(out, { recursive: true });
  const random = createRandom(seed);
  const projectId = hex(random, 32);
  const shared = path.join(out, 'shared');
  const folder = path.join(shared, 'projects', projectId);
  mkdirSync(path.join(shared, '.internal'), { recursive: true });
  writeFileSync(path.join(shared, 'workspace.json'), jsonFile({ format: 'agboard-files', formatVersion: 1 }));
  // The first-run guide is marked as skipped, so the screen shows the board.
  writeFileSync(
    path.join(shared, '.internal', 'onboarding.json'),
    jsonFile({ formatVersion: 1, revision: 1, status: 'skipped', owner: null, run: null, appliedCommands: [] }),
  );
  mkdirSync(folder, { recursive: true });
  writeFileSync(path.join(folder, 'README.md'), `# ${PROJECT_NAME}\n\nBenchmark fixture written by scripts/bench/gen-fixture.mjs.\n`);
  writeFileSync(
    path.join(folder, 'project.json'),
    jsonFile({
      formatVersion: 1,
      id: projectId,
      name: PROJECT_NAME,
      createdAt: isoAt(BASE_MS),
      nextTaskId: TASK_COUNT + 1,
      defaultEpicsSeeded: true,
    }),
  );

  const epicIds = Array.from({ length: EPIC_COUNT }, (_, index) => `BENCH-${pad(index + 1, 2)}`);
  epicIds.forEach((epicId, index) => {
    const dir = path.join(folder, 'epics', epicId);
    mkdirSync(dir, { recursive: true });
    const createdAt = isoAt(BASE_MS + index * MINUTE_MS);
    const color = `#${hex(random, 6).toUpperCase()}`;
    writeFileSync(
      path.join(dir, 'epic.json'),
      jsonFile({
        formatVersion: 1,
        id: epicId,
        name: `Bench epic ${pad(index + 1, 2)}`,
        color,
        isDraft: false,
        attachments: [],
        createdAt,
        updatedAt: createdAt,
      }),
    );
    let document;
    if (index < LONG_EPIC_COUNT) {
      const priority = Array.from({ length: 3 }, (_, k) => HEAVY_TASK_IDS[k] ?? k + 1).map((id) => `  - ${id}`);
      document = `---\npriority:\n${priority.join('\n')}\n---\n\n${longBody(random, `Epic ${index + 1}`)}`;
    } else {
      document = `# Bench epic ${pad(index + 1, 2)}\n\nA short description for epic ${index + 1}.\n`;
    }
    writeFileSync(path.join(dir, 'EPIC.md'), document);
    touch(path.join(dir, 'epic.json'), createdAt);
    touch(path.join(dir, 'EPIC.md'), createdAt);
  });

  // Lanes: 100 cards each, in the order todo, doing, done. Positions count up inside each lane.
  const lanes = ['todo', 'doing', 'done'];
  const lanePosition = { todo: 0, doing: 0, done: 0 };
  const pngBytes = Buffer.from(PNG_BASE64, 'base64');
  let attachmentCount = 0;
  for (let id = 1; id <= TASK_COUNT; id++) {
    const lane = lanes[(id - 1) % 3];
    lanePosition[lane] += 1;
    const position = lanePosition[lane];
    const createdMs = BASE_MS + id * MINUTE_MS;
    const createdAt = isoAt(createdMs);
    const assignee = id % 2 === 1 ? 'ai' : 'human';
    const epicId = id % 10 < 7 ? epicIds[(id % EPIC_COUNT)] : null;
    const heavy = HEAVY_TASK_IDS.includes(id);
    const heavyIndex = HEAVY_TASK_IDS.indexOf(id);
    const hasHistory = id % HISTORY_STRIDE === 0;

    const events = [];
    if (hasHistory) {
      for (let entry = 0; entry < HISTORY_ENTRIES; entry++) {
        const at = isoAt(createdMs + (entry + 1) * 45_000);
        events.push({
          at,
          reason: `Progress note ${entry + 1} for task ${id}: checked the board state and recorded the result.`,
        });
      }
    }
    const updatedAt = events.length > 0 ? events[events.length - 1].at : createdAt;

    const attachments = [];
    let body;
    let title;
    if (heavy) {
      title = `Bench heavy task ${id}`;
      const images = [];
      for (let k = 0; k < IMAGES_PER_HEAVY_TASK; k++) {
        const attachmentId = hex(random, 32);
        images.push(attachmentId);
        attachments.push({
          id: attachmentId,
          name: `figure-${k + 1}.png`,
          mediaType: 'image/png',
          size: pngBytes.length,
          createdAt: updatedAt,
        });
      }
      attachmentCount += images.length;
      body = longBody(random, `Heavy ${id}`, images, MERMAID_PER_HEAVY_TASK[heavyIndex]);
    } else {
      title = `Bench task ${pad(id, 3)} ${sentence(random, 3).replace(/\.$/, '')}`;
      body = shortBody(random, id, lane, position);
    }

    const dir = path.join(folder, 'tasks', String(id));
    mkdirSync(path.join(dir, 'assets'), { recursive: true });
    for (const attachment of attachments) {
      writeFileSync(path.join(dir, 'assets', `${attachment.id}.png`), pngBytes);
    }
    const task = {
      formatVersion: 1,
      id,
      title,
      assignee,
      epicId,
      taskStatus: lane,
      taskStatusChangedAt: createdAt,
      agentStatus: 'idle',
      agentStatusChangedAt: createdAt,
      position,
      isDraft: false,
      archivedAt: null,
      pendingRequestId: null,
      pendingRequest: null,
      requestAnswers: [],
      createdAt,
      updatedAt,
      attachments,
    };
    writeFileSync(path.join(dir, 'task.json'), jsonFile(task));
    writeFileSync(path.join(dir, 'TASK.md'), taskMarkdown(body, events));
    touch(path.join(dir, 'task.json'), updatedAt);
    touch(path.join(dir, 'TASK.md'), updatedAt);
  }
  return { out, projectId, attachmentCount, ...digest(out) };
}

/** Every file under `root` as a sorted list of relative paths, and one digest over the names and contents. */
export function digest(root) {
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else files.push(path.relative(root, full).split(path.sep).join('/'));
    }
  };
  walk(root);
  const hash = createHash('sha256');
  let bytes = 0;
  for (const relative of files) {
    const content = readFileSync(path.join(root, relative));
    bytes += content.length;
    hash.update(`${relative}\t${createHash('sha256').update(content).digest('hex')}\n`);
  }
  return { files: files.length, bytes, digest: hash.digest('hex') };
}

function main(argv) {
  const args = { seed: DEFAULT_SEED };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') args.out = argv[++i];
    else if (argv[i] === '--seed') args.seed = Number(argv[++i]);
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  if (!args.out) throw new Error('usage: gen-fixture.mjs --out <empty-dir> [--seed <integer>]');
  const summary = generateFixture(path.resolve(args.out), args.seed);
  process.stdout.write(`${JSON.stringify({ seed: args.seed, ...summary }, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
