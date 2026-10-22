// The TypeScript contract against the same golden examples the Rust tests read.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ContractError,
  DetailStreamValidator,
  parseChanged,
  parseDetailLine,
  parseSummary,
  readDetailStream,
} from './index';

const DIR = join(__dirname, '../../../../../tests/fixtures/data-layer');
const read = (...path: string[]) => readFileSync(join(DIR, ...path), 'utf8');
const invalid = (prefix: string) =>
  readdirSync(join(DIR, 'invalid'))
    .filter((name) => name.startsWith(prefix))
    .sort();

describe('summary', () => {
  it('parses the golden example without changing it', () => {
    const original = JSON.parse(read('summary.json'));
    expect(parseSummary(original)).toEqual(original);
  });

  it('carries versions and no full text', () => {
    const summary = parseSummary(JSON.parse(read('summary.json')));
    for (const task of summary.tasks) {
      expect(Object.keys(task)).not.toContain('body');
      expect(Object.keys(task)).not.toContain('history');
      expect(task.detailVersions.document).toBeTruthy();
      expect(task.detailVersions.history).toBeTruthy();
    }
    expect(summary.epics[0]?.detailVersions.document).toBeTruthy();
  });

  it('keeps the condition read error, the creation time and the epic order', () => {
    const summary = parseSummary(JSON.parse(read('summary.json')));
    expect(summary.tasks.map((t) => [t.acceptanceError, t.createdAt])).toEqual([
      [false, '2026-10-22T09:45:32Z'],
      [true, '2026-10-22T09:58:00Z'],
    ]);
    expect(summary.epics[0]?.priority).toEqual([303, 302]);
    expect(summary.epics[0]?.priorityError).toBe(false);
  });

  it('refuses a task or epic without the new fields, or with a wrong type', () => {
    type Entry = Record<string, unknown>;
    type Doc = { tasks: Entry[]; epics: Entry[] };
    const base = JSON.parse(read('summary.json')) as Doc;
    const task = (doc: Doc) => doc.tasks[0] as Entry;
    const epic = (doc: Doc) => doc.epics[0] as Entry;
    for (const [pick, key] of [
      [task, 'acceptanceError'],
      [task, 'createdAt'],
      [epic, 'priority'],
      [epic, 'priorityError'],
    ] as const) {
      const copy = structuredClone(base);
      delete pick(copy)[key];
      expect(() => parseSummary(copy), key).toThrow(ContractError);
    }
    for (const [pick, key, value] of [
      [task, 'acceptanceError', 'yes'],
      [task, 'createdAt', 5],
      [epic, 'priority', [1.5]],
      [epic, 'priority', [0]],
      [epic, 'priority', '303'],
      [epic, 'priorityError', 1],
    ] as const) {
      const copy = structuredClone(base);
      pick(copy)[key] = value;
      expect(() => parseSummary(copy), `${key}=${JSON.stringify(value)}`).toThrow(ContractError);
    }
  });

  it('refuses every invalid example', () => {
    const names = invalid('summary-');
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(() => parseSummary(JSON.parse(read('invalid', name))), name).toThrow(ContractError);
    }
  });
});

describe('detail stream', () => {
  it('reads the golden examples as the events they hold', () => {
    for (const name of ['task-detail.ndjson', 'task-detail-history.ndjson', 'epic-detail.ndjson']) {
      const text = read(name);
      const events = readDetailStream(text);
      const lines = text.split('\n').filter((line) => line !== '');
      expect(events, name).toEqual(lines.map((line) => JSON.parse(line)));
    }
  });

  it('keeps the image size optional', () => {
    const events = readDetailStream(read('task-detail.ndjson'));
    const images = events.flatMap((e) => (e.type === 'block' ? (e.images ?? []) : []));
    expect(images[0]).toEqual({ src: expect.any(String), width: 640, height: 360 });
    expect(images[1]?.width).toBeUndefined();
  });

  it('reads the attachments of a document once, right after section-start', () => {
    const task = readDetailStream(read('task-detail.ndjson'));
    const listed = task.filter((e) => e.type === 'attachments');
    expect(listed).toHaveLength(1);
    expect(task[2]).toEqual(listed[0]);
    expect(listed[0]).toMatchObject({
      items: [
        { id: 'a1', name: 'diagram.png', mediaType: 'image/png', size: 1024 },
        { id: 'a2', name: 'notes.webp', mediaType: 'image/webp', size: 2048 },
      ],
    });
    const epic = readDetailStream(read('epic-detail.ndjson'));
    expect(epic[2]).toEqual({ type: 'attachments', items: [] });
  });

  it('refuses attachments that come late, twice, in history, or with a wrong item', () => {
    const reasons: Record<string, RegExp> = {
      'detail-attachments-after-acceptance.ndjson': /before the first block/,
      'detail-attachments-after-block.ndjson': /before the first block/,
      'detail-attachments-fractional-size.ndjson': /attachments\.items\[0\]\.size/,
      'detail-attachments-in-history.ndjson': /belongs in the history section/,
      'detail-attachments-missing-name.ndjson': /attachments\.items\[0\]\.name/,
      'detail-attachments-twice.ndjson': /one attachments event/,
      'detail-attachments-unknown-field.ndjson':
        /attachments\.items\[0\]\.url: expected no such field/,
    };
    expect(invalid('detail-attachments-')).toEqual(Object.keys(reasons));
    for (const [name, reason] of Object.entries(reasons)) {
      expect(() => readDetailStream(read('invalid', name)), name).toThrow(reason);
    }
  });

  it('does not count the attachments as an item of the section', () => {
    const lines = read('task-detail.ndjson').split('\n').filter(Boolean);
    const withoutList = lines.filter((line) => !line.includes('"type":"attachments"'));
    expect(() => readDetailStream(`${withoutList.join('\n')}\n`)).not.toThrow();
    const miscount = lines.map((line) =>
      line.includes('"section":"document","count":5')
        ? line.replace('"count":5', '"count":6')
        : line,
    );
    expect(() => readDetailStream(`${miscount.join('\n')}\n`)).toThrow(ContractError);
  });

  it('refuses every invalid example', () => {
    const names = invalid('detail-');
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(() => readDetailStream(read('invalid', name)), name).toThrow(ContractError);
    }
  });

  it('refuses an unknown type and an order violation by name', () => {
    expect(() => parseDetailLine('{"type":"future-event"}')).toThrow(ContractError);
    expect(() => parseDetailLine('{"type":"block","kind":"markdown"')).toThrow(ContractError);
    const validator = new DetailStreamValidator();
    expect(() => validator.accept({ type: 'section-start', section: 'document' })).toThrow(
      /start first/,
    );
  });

  it('is not whole until complete arrives', () => {
    const lines = read('epic-detail.ndjson').split('\n').filter(Boolean);
    const validator = new DetailStreamValidator();
    for (const line of lines.slice(0, -1)) validator.accept(parseDetailLine(line));
    expect(() => validator.finish()).toThrow(/complete/);
    validator.accept(parseDetailLine(lines.at(-1) ?? ''));
    expect(() => validator.finish()).not.toThrow();
  });
});

describe('changed event', () => {
  it('parses the golden example from an object and from its text', () => {
    const text = read('changed.json');
    const original = JSON.parse(text);
    expect(parseChanged(original)).toEqual(original);
    expect(parseChanged(text)).toEqual(original);
  });

  it('refuses every invalid example', () => {
    const names = invalid('changed-');
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(() => parseChanged(read('invalid', name)), name).toThrow(ContractError);
    }
  });

  it('refuses text that is not JSON', () => {
    expect(() => parseChanged('{')).toThrow(ContractError);
  });
});
