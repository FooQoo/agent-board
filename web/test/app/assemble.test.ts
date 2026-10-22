import { describe, expect, it } from 'vitest';
import {
  assembleEpic,
  assembleTask,
  bodyOf,
  toBoardView,
  toTaskSummary,
} from '../../src/app/data/assemble';
import { summaryOfBoard } from '../../src/app/development/boardWire';
import type { Summary, SummaryEpic, SummaryTask } from '../../src/shared/data/api';
import type { DocumentData, HistoryData } from '../../src/shared/data/core';
import type { Epic } from '../../src/shared/api/contracts';
import { fixtureBoard, makeTask } from '../fixtures';

const summary: Summary = summaryOfBoard({
  ...fixtureBoard,
  tasks: [
    makeTask({
      id: 5,
      title: 'With epic',
      epic: { id: 'E-1', name: 'Epic one', color: '#112233' },
      acceptance: [
        { id: 'AC-1', text: 'one', done: true },
        { id: 'AC-2', text: 'two', done: false },
      ],
    }),
    makeTask({ id: 6, title: 'Plain', epic: null }),
  ],
  epics: [
    {
      id: 'E-1',
      name: 'Epic one',
      color: '#112233',
      isDraft: true,
      document: '',
      body: 'epic text',
      priority: [],
      priorityError: false,
      attachments: [],
      createdAt: '',
      updatedAt: '',
    },
  ],
  epicTaskCounts: { 'E-1': { todo: 1, doing: 0, done: 0, archived: 2, total: 3 } },
});

const [withEpic, plain] = summary.tasks as [SummaryTask, SummaryTask];
const [epicOne] = summary.epics as [SummaryEpic];

const document_: DocumentData = {
  blocks: [
    { kind: 'markdown', text: '# Title\n\nFirst paragraph.\n\n' },
    { kind: 'markdown', text: '- item\n' },
  ],
  acceptance: [{ id: 'AC-1', text: 'one', done: true }],
};
const history: HistoryData = { items: [{ at: '2026-01-01T00:00:00Z', reason: 'made' }] };

describe('the list bridge', () => {
  it('makes a card of a Summary task: counts, no body, the epic resolved', () => {
    const card = toTaskSummary(withEpic, summary.epics);
    expect(card.acceptance).toEqual({ done: 1, total: 2 });
    expect(card.epic).toEqual({ id: 'E-1', name: 'Epic one', color: '#112233' });
    expect('body' in card).toBe(false);
    expect('history' in card).toBe(false);
    expect(toTaskSummary(plain, summary.epics).epic).toBeNull();
  });

  it('makes a board view with the epics and their counts from the Summary', () => {
    const view = toBoardView(summary);
    expect(view.tasks.map((task) => task.id)).toEqual([5, 6]);
    expect(view.epics.map((epic) => [epic.id, epic.isDraft, epic.body])).toEqual([
      ['E-1', true, ''],
    ]);
    expect(view.epicTaskCounts['E-1']).toEqual({
      todo: 1,
      doing: 0,
      done: 0,
      archived: 2,
      total: 3,
    });
  });
});

describe('assembleTask', () => {
  const card = toTaskSummary(withEpic, summary.epics);

  it('joins the blocks into the body and takes the conditions and the history from the Detail', () => {
    const task = assembleTask(card, { document: document_, history });
    expect(task.body).toBe('# Title\n\nFirst paragraph.\n\n- item\n');
    expect(task.acceptance).toEqual([{ id: 'AC-1', text: 'one', done: true }]);
    expect(task.history).toEqual([{ at: '2026-01-01T00:00:00Z', reason: 'made' }]);
    expect(task.title).toBe('With epic');
    expect(task.epic?.id).toBe('E-1');
  });

  it('shows an empty body and history while the Detail has not arrived', () => {
    const task = assembleTask(card, { document: null, history: null });
    expect(task.body).toBe('');
    expect(task.acceptance).toEqual([]);
    expect(task.history).toEqual([]);
  });

  it('gives the whole file text as the body, because the frontmatter is not sent', () => {
    expect(assembleTask(card, { document: document_, history }).description).toBe(
      bodyOf(document_),
    );
  });
});

describe('assembleEpic', () => {
  it('puts the joined blocks in the epic body and document', () => {
    const base = toBoardView(summary).epics.find((item) => item.id === epicOne.id) as Epic;
    const epic = assembleEpic(base, document_);
    expect(epic.body).toBe('# Title\n\nFirst paragraph.\n\n- item\n');
    expect(epic.document).toBe(epic.body);
    expect(epic.name).toBe('Epic one');
  });
});
