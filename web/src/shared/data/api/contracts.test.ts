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
