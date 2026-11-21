#!/usr/bin/env node
// One-shot move of the AI drafts of earlier versions into the Backlog.
//
// Earlier versions marked a plan an agent made with `"draft": "ai"` and left it in
// Todo or Doing. Agent Board no longer reads that mark: a file that still holds it is
// reported as invalid. This script rewrites such files once:
//
//   task.json, in Todo or Doing and not archived:
//       taskStatus -> "backlog", agentStatus -> "idle", formatVersion -> 2,
//       draft -> null, updatedAt -> now, and one history line in TASK.md.
//   task.json, in Done or archived: only draft -> null (lane and archive stay).
//   epic.json: draft -> null, updatedAt -> now.
//
// Every other file is left as it is, and a second run finds nothing to change. Each
// file is written to a temporary file in its own folder and renamed over the original.
// The obsolete marker `.internal/backlog-migrated` is removed.
//
// Usage: node scripts/migrate-ai-drafts.mjs [--dry-run] [DATA_DIR]
// DATA_DIR defaults to $AGBOARD_HOME, then ~/.agent-board. Stop `agboard serve` first.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const TASK_ID = /^[0-9]+$/;
const EPIC_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export function defaultDataDir(env = process.env) {
  return env.AGBOARD_HOME ? env.AGBOARD_HOME : path.join(os.homedir(), '.agent-board');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeAtomic(file, text) {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.migrate-${process.pid}.tmp`);
  try {
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, file);
  } catch (error) {
    fs.rmSync(tmp, { force: true });
    throw error;
  }
}

const isLegacy = (value) => value !== null && typeof value === 'object' && value.draft === 'ai';

function stamp(now) {
  return now.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** The result of converting a parsed task.json, or null when it needs nothing. */
export function convertTask(task, now) {
  if (!isLegacy(task)) return null;
  const from = task.taskStatus;
  const archived = task.archivedAt !== undefined && task.archivedAt !== null;
  const next = { ...task, draft: null };
  const toBacklog = !archived && (from === 'todo' || from === 'doing');
  if (toBacklog) {
    next.taskStatus = 'backlog';
    next.agentStatus = 'idle';
    next.formatVersion = 2;
    next.updatedAt = stamp(now);
  }
  return { next, toBacklog, from };
}

/** The result of converting a parsed epic.json, or null when it needs nothing. */
export function convertEpic(epic, now) {
  if (!isLegacy(epic)) return null;
  return { ...epic, draft: null, updatedAt: stamp(now) };
}

/** Append one history entry to the frontmatter of a TASK.md. Null if it cannot be done safely. */
export function appendHistory(markdown, at, reason) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/.exec(markdown);
  if (!match) return null;
  const front = match[1].split(/\r?\n/);
  const start = front.findIndex((line) => /^history:/.test(line));
  if (start < 0) return null;
  const quoted = JSON.stringify(reason);
  const head = front[start].trim();
  let insertAt = start + 1;
  let indent = '';
  if (head === 'history: []') {
    front.splice(start, 1, 'history:');
    insertAt = start + 1;
  } else if (head !== 'history:') {
    return null;
  } else {
    let end = start + 1;
    while (end < front.length && (front[end] === '' || /^[\s-]/.test(front[end]))) end += 1;
    while (end > start + 1 && front[end - 1] === '') end -= 1;
    insertAt = end;
    const first = front.slice(start + 1, end).find((line) => /^\s*- /.test(line));
    indent = first ? first.match(/^(\s*)/)[1] : '';
  }
  front.splice(insertAt, 0, `${indent}- at: ${at}`, `${indent}  reason: ${quoted}`);
  const eol = markdown.includes('\r\n') ? '\r\n' : '\n';
  return `---${eol}${front.join(eol)}${eol}---${markdown.slice(match[0].length - match[2].length)}`;
}

function listDirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name);
  } catch {
    return [];
  }
}

function serverPid(dataDir) {
  let info;
  try {
    info = readJson(path.join(dataDir, 'serve.json'));
  } catch {
    return null;
  }
  const pid = Number(info.pid);
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    process.kill(pid, 0);
    return pid;
  } catch (error) {
    return error.code === 'EPERM' ? pid : null;
  }
}

/**
 * Move the AI drafts of every project under `dataDir` into the Backlog.
 * Returns `{ tasks, epics, markers, problems }`; with `dryRun` nothing is written.
 */
export function migrate(dataDir, { dryRun = false, now = new Date() } = {}) {
  const shared = path.join(dataDir, 'shared');
  const projectsDir = path.join(shared, 'projects');
  if (!fs.existsSync(projectsDir)) throw new Error(`No projects folder at ${projectsDir}.`);
  const pid = serverPid(dataDir);
  if (pid !== null) {
    throw new Error(`agboard serve is running (pid ${pid}). Stop it first so no write races this script.`);
  }
  const result = { tasks: [], epics: [], markers: [], problems: [] };
  for (const project of listDirs(projectsDir)) {
    const dir = path.join(projectsDir, project);
    const pending = path.join(dir, '.internal', 'transactions');
    if (fs.existsSync(pending) && fs.readdirSync(pending).length > 0) {
      throw new Error(`Project ${project} has an unfinished save in .internal/transactions. Run any agboard write command once to recover it, then run this again.`);
    }
    for (const id of listDirs(path.join(dir, 'tasks')).filter((n) => TASK_ID.test(n))) {
      const folder = path.join(dir, 'tasks', id);
      const file = path.join(folder, 'task.json');
      if (!fs.existsSync(file)) continue;
      let task;
      try {
        task = readJson(file);
      } catch (error) {
        result.problems.push(`${file}: ${error.message}`);
        continue;
      }
      const converted = convertTask(task, now);
      if (!converted) continue;
      const entry = { project, id: Number(id), title: task.title ?? '', from: converted.from, to: converted.toBacklog ? 'backlog' : converted.from };
      result.tasks.push(entry);
      if (dryRun) continue;
      writeAtomic(file, `${JSON.stringify(converted.next, null, 2)}\n`);
      if (converted.toBacklog) {
        const mdFile = path.join(folder, 'TASK.md');
        const markdown = fs.existsSync(mdFile) ? fs.readFileSync(mdFile, 'utf8') : null;
        const updated = markdown && appendHistory(markdown, stamp(now), `Moved the AI draft from ${converted.from} to the Backlog.`);
        if (updated) writeAtomic(mdFile, updated);
        else result.problems.push(`${mdFile}: history line not added (unexpected format); task.json was converted.`);
      }
    }
    for (const id of listDirs(path.join(dir, 'epics')).filter((n) => EPIC_ID.test(n))) {
      const file = path.join(dir, 'epics', id, 'epic.json');
      if (!fs.existsSync(file)) continue;
      let epic;
      try {
        epic = readJson(file);
      } catch (error) {
        result.problems.push(`${file}: ${error.message}`);
        continue;
      }
      const next = convertEpic(epic, now);
      if (!next) continue;
      result.epics.push({ project, id, name: epic.name ?? '' });
      if (!dryRun) writeAtomic(file, `${JSON.stringify(next, null, 2)}\n`);
    }
    const marker = path.join(dir, '.internal', 'backlog-migrated');
    if (fs.existsSync(marker)) {
      result.markers.push(marker);
      if (!dryRun) fs.rmSync(marker);
    }
  }
  return result;
}

function main(argv) {
  const args = argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const rest = args.filter((a) => a !== '--dry-run');
  if (rest.some((a) => a.startsWith('-'))) {
    console.error('Usage: node scripts/migrate-ai-drafts.mjs [--dry-run] [DATA_DIR]');
    return 2;
  }
  const dataDir = rest[0] ?? defaultDataDir();
  let result;
  try {
    result = migrate(dataDir, { dryRun });
  } catch (error) {
    console.error(`migrate-ai-drafts: ${error.message}`);
    return 1;
  }
  const verb = dryRun ? 'Would move' : 'Moved';
  for (const t of result.tasks) {
    const where = t.to === 'backlog' ? `${t.from} -> backlog` : `${t.from} (draft mark removed)`;
    console.log(`${verb} task ${t.project}/#${t.id} "${t.title}": ${where}`);
  }
  for (const e of result.epics) console.log(`${verb} epic ${e.project}/${e.id} "${e.name}": draft mark removed`);
  for (const m of result.markers) console.log(`${dryRun ? 'Would remove' : 'Removed'} ${m}`);
  for (const p of result.problems) console.warn(`warning: ${p}`);
  console.log(`${dryRun ? 'Dry run: ' : ''}${result.tasks.length} task(s), ${result.epics.length} epic(s)${dryRun ? ' would change; nothing was written.' : ' changed.'}`);
  return result.problems.length > 0 ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv);
}
