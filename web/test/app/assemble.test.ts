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

const stored = (id: string, name: string) => ({
  id,
  name,
  mediaType: 'image/png',
  size: 120,
  createdAt: '2026-02-03T04:05:06Z',
});

describe('what the Summary now keeps', () => {
  const rich: Summary = summaryOfBoard({
    ...fixtureBoard,
    tasks: [
      makeTask({
        id: 8,
        acceptanceError: true,
        createdAt: '2026-01-02T03:04:05Z',
        updatedAt: '2026-05-06T07:08:09Z',
      }),
    ],
    epics: [
      {
        id: 'E-2',
        name: 'Ordered',
        color: '#445566',
        isDraft: false,
        document: '',
        body: '',
        priority: [8, 3],
        priorityError: true,
        attachments: [],
        createdAt: '',
        updatedAt: '',
      },
    ],
    epicTaskCounts: {},
  });

  it('puts the condition read error and the creation time on the card', () => {
    const card = toTaskSummary(rich.tasks[0] as SummaryTask, rich.epics);
    expect(card.acceptanceError).toBe(true);
    expect(card.createdAt).toBe('2026-01-02T03:04:05Z');
    expect(toTaskSummary(withEpic, summary.epics).acceptanceError).toBe(false);
  });

  it('gives the epic its task order and the order error, from the Summary', () => {
    const [epic] = toBoardView(rich).epics;
    expect(epic?.priority).toEqual([8, 3]);
    expect(epic?.priorityError).toBe(true);
    expect(toBoardView(summary).epics[0]?.priority).toEqual([]);
  });

  it('assembles a task with its own creation time, not the last update', () => {
    const card = toTaskSummary(rich.tasks[0] as SummaryTask, rich.epics);
    const task = assembleTask(card, { document: document_, history });
    expect(task.createdAt).toBe('2026-01-02T03:04:05Z');
    expect(task.updatedAt).toBe('2026-05-06T07:08:09Z');
    expect(task.acceptanceError).toBe(true);
  });

  it('takes the task attachments from the Detail and shows none before it arrives', () => {
    const card = toTaskSummary(withEpic, summary.epics);
    const list = [stored('a1', 'one.png'), stored('a2', 'two.png')];
    expect(
      assembleTask(card, { document: { ...document_, attachments: list }, history }).attachments,
    ).toEqual(list);
    expect(assembleTask(card, { document: document_, history }).attachments).toEqual([]);
    expect(assembleTask(card, { document: null, history: null }).attachments).toEqual([]);
  });

  it('edits a card with unreadable conditions from the whole text, which the body is', () => {
    // With an unclosed frontmatter the server sends the whole file as the body, so the editor's
    // whole-file mode (task.description) starts from the same text. (A closed but unreadable
    // frontmatter is cut off from the body; the Rust test of the Detail reader pins that.)
    const whole = '---\nacceptance: [unclosed\n';
    const card = toTaskSummary(rich.tasks[0] as SummaryTask, rich.epics);
    const task = assembleTask(card, {
      document: { blocks: [{ kind: 'markdown', text: whole }], acceptance: [] },
      history: null,
    });
    expect(task.acceptanceError).toBe(true);
    expect(task.description).toBe(whole);
    expect(task.body).toBe(whole);
  });

  it('takes the epic attachments from the Detail', () => {
    const base = toBoardView(summary).epics[0] as Epic;
    const list = [stored('e1', 'plan.png')];
    expect(assembleEpic(base, { ...document_, attachments: list }).attachments).toEqual(list);
    expect(assembleEpic(base, document_).attachments).toEqual([]);
    expect(assembleEpic(base, null).attachments).toEqual([]);
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
