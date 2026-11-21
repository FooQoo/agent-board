import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { appendHistory, migrate } from './migrate-ai-drafts.mjs';

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrate-ai-drafts.mjs');
const NOW = new Date('2026-11-21T00:00:00.000Z');

function task(id, taskStatus, draft, extra = {}) {
  return { formatVersion: 1, id, title: `Task ${id}`, assignee: 'ai', epicId: null, taskStatus, agentStatus: 'idle', position: id, draft, archivedAt: null, updatedAt: '2026-10-01T00:00:00Z', ...extra };
}

function fixture() {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'agb-migrate-'));
  const project = path.join(data, 'shared', 'projects', 'p1');
  const put = (rel, text) => {
    const file = path.join(project, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  };
  const tasks = [
    task(1, 'todo', 'ai'),
    task(2, 'doing', 'ai', { agentStatus: 'running' }),
    task(3, 'done', 'ai'),
    task(4, 'todo', 'ai', { archivedAt: '2026-10-02T00:00:00Z' }),
    task(5, 'todo', 'human'),
    task(6, 'todo', null),
    task(7, 'doing', null),
    task(8, 'done', null),
    task(9, 'backlog', null, { formatVersion: 2 }),
    task(10, 'done', null, { archivedAt: '2026-10-02T00:00:00Z' }),
  ];
  for (const t of tasks) {
    put(`tasks/${t.id}/task.json`, `${JSON.stringify(t, null, 2)}\n`);
    const history = t.id === 1 ? 'history: []' : 'history:\n- at: 2026-10-01T00:00:00Z\n  reason: created';
    put(`tasks/${t.id}/TASK.md`, `---\nacceptance: []\n${history}\n---\n\nBody ${t.id}\n`);
  }
  put('epics/OLD/epic.json', `${JSON.stringify({ formatVersion: 1, id: 'OLD', name: 'Old', draft: 'ai', updatedAt: '2026-10-01T00:00:00Z' }, null, 2)}\n`);
  put('epics/KEEP/epic.json', `${JSON.stringify({ formatVersion: 1, id: 'KEEP', name: 'Keep', draft: null, updatedAt: '2026-10-01T00:00:00Z' }, null, 2)}\n`);
  put('.internal/backlog-migrated', '1\n');
  return { data, project };
}

function snapshot(dir) {
  const out = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out[path.relative(dir, p)] = fs.readFileSync(p, 'utf8');
    }
  };
  walk(dir);
  return out;
}

const json = (project, rel) => JSON.parse(fs.readFileSync(path.join(project, rel), 'utf8'));

test('moves legacy AI drafts, leaves other work untouched, and a second run changes nothing', () => {
  const { data, project } = fixture();
  const before = snapshot(project);
  const result = migrate(data, { now: NOW });

  assert.deepEqual(result.tasks.map((t) => t.id), [1, 2, 3, 4]);
  assert.deepEqual(result.epics.map((e) => e.id), ['OLD']);
  assert.equal(result.markers.length, 1);

  for (const id of [1, 2]) {
    const t = json(project, `tasks/${id}/task.json`);
    assert.equal(t.taskStatus, 'backlog');
    assert.equal(t.agentStatus, 'idle');
    assert.equal(t.formatVersion, 2);
    assert.equal(t.draft, null);
    assert.equal(t.updatedAt, '2026-11-21T00:00:00Z');
    const md = fs.readFileSync(path.join(project, `tasks/${id}/TASK.md`), 'utf8');
    assert.match(md, /reason: "Moved the AI draft from (todo|doing) to the Backlog\."/);
  }
  const done = json(project, 'tasks/3/task.json');
  assert.equal(done.taskStatus, 'done');
  assert.equal(done.draft, null);
  const archived = json(project, 'tasks/4/task.json');
  assert.equal(archived.taskStatus, 'todo');
  assert.equal(archived.archivedAt, '2026-10-02T00:00:00Z');
  assert.equal(archived.draft, null);
  assert.equal(json(project, 'epics/OLD/epic.json').draft, null);
  assert.equal(fs.existsSync(path.join(project, '.internal/backlog-migrated')), false);

  const after = snapshot(project);
  for (const id of [5, 6, 7, 8, 9, 10]) {
    for (const file of ['task.json', 'TASK.md']) {
      const key = path.join('tasks', String(id), file);
      assert.equal(after[key], before[key], key);
    }
  }
  const keep = path.join('epics', 'KEEP', 'epic.json');
  assert.equal(after[keep], before[keep]);
  assert.equal(Object.keys(after).some((k) => k.endsWith('.tmp')), false);

  const again = migrate(data, { now: new Date('2026-12-01T00:00:00Z') });
  assert.deepEqual([again.tasks, again.epics, again.markers], [[], [], []]);
  assert.deepEqual(snapshot(project), after);
});

test('--dry-run lists the changes and writes nothing', () => {
  const { data, project } = fixture();
  const before = snapshot(project);
  const result = migrate(data, { dryRun: true, now: NOW });
  assert.equal(result.tasks.length, 4);
  assert.equal(result.epics.length, 1);
  assert.deepEqual(snapshot(project), before);

  const run = spawnSync(process.execPath, [script, '--dry-run', data], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /Would move task p1\/#1 "Task 1": todo -> backlog/);
  assert.match(run.stdout, /Would move epic p1\/OLD/);
  assert.deepEqual(snapshot(project), before);
});

test('refuses to run while agboard serve is running', () => {
  const { data, project } = fixture();
  fs.writeFileSync(path.join(data, 'serve.json'), JSON.stringify({ pid: process.pid, port: 1, started_at: 'now' }));
  const before = snapshot(project);
  assert.throws(() => migrate(data, { now: NOW }), /agboard serve is running/);
  assert.deepEqual(snapshot(project), before);
  // A stale serve.json (no such process) does not block.
  fs.writeFileSync(path.join(data, 'serve.json'), JSON.stringify({ pid: 2 ** 22 + 12345, port: 1, started_at: 'now' }));
  assert.equal(migrate(data, { dryRun: true, now: NOW }).tasks.length, 4);
});

test('appendHistory handles empty and indented histories', () => {
  const empty = appendHistory('---\nhistory: []\n---\nbody\n', '2026-11-21T00:00:00Z', 'x');
  assert.equal(empty, '---\nhistory:\n- at: 2026-11-21T00:00:00Z\n  reason: "x"\n---\nbody\n');
  const indented = appendHistory('---\nhistory:\n  - at: a\n    reason: b\nquestions: [Q-1]\n---\nbody', 'T', 'x');
  assert.equal(indented, '---\nhistory:\n  - at: a\n    reason: b\n  - at: T\n    reason: "x"\nquestions: [Q-1]\n---\nbody');
});
