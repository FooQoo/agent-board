import type { Board, Epic, Problem, Project, Task } from '../../../shared/api/contracts.ts';

/**
 * The sample boards of the sample-data server (`server.ts`). The fixture board and the long
 * Markdown text are passed in, so this module reads no files and runs in a browser as well as in
 * Node. Only the sample-data server and the tests import it; the production build does not.
 */

/** The mock keeps the board's parts; the version and cursor are made from the revision when it answers. */
export interface MockBoard {
  project: Project;
  revision: number;
  epics: Epic[];
  problems: Problem[];
  tasks: Task[];
}

/** What the sample boards are made from: the fixture board and a long Markdown description. */
export interface MockSeed {
  fixture: Pick<Board, 'tasks'>;
  longMarkdown: string;
}

/** An epic the sample board shows: its label and frame on a few cards. */
const SAMPLE_DOCUMENT = `## 目的

共有ファイルの画面を整える。

## 進め方

順に進める。

## 参考条件

- [x] 本文が読める
- [ ] 画像が並ぶ
`;
export const SAMPLE_EPIC: Epic = {
  id: 'FILE-SHARE',
  name: 'File share',
  color: '#7C3AED',
  isDraft: false,
  document: SAMPLE_DOCUMENT,
  body: SAMPLE_DOCUMENT,
  priority: [],
  priorityError: false,
  attachments: [],
  createdAt: '2026-10-01T07:00:00Z',
  updatedAt: '2026-10-01T07:00:00Z',
};
const SAMPLE_EPIC_TASKS = [11, 12, 14];

/** Completion conditions the sample cards show: one part done, and all done. */
const SAMPLE_CONDITIONS: Record<number, Task['acceptance']> = {
  11: [
    { id: 'AC-1', text: 'Tasks move between lanes', done: true },
    { id: 'AC-2', text: 'Each move confirms the status change', done: true },
    { id: 'AC-3', text: 'The history keeps the reason', done: false },
    { id: 'AC-4', text: 'A waiting task goes back to idle', done: false },
  ],
  12: [
    { id: 'AC-1', text: 'The board shows the restore', done: true },
    { id: 'AC-2', text: 'The archive keeps the lane', done: true },
  ],
};

/** The sample projects. The first holds the fixture board, the second a smaller one, the third none. */
export const SAMPLE_PROJECTS: Project[] = [
  {
    id: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
    name: 'agent-board',
    createdAt: '2026-10-01T07:00:00Z',
  },
  { id: 'b2c3d4e5f60718293a4b5c6d7e8f90a1', name: 'knowledge', createdAt: '2026-10-01T08:00:00Z' },
  { id: 'c3d4e5f60718293a4b5c6d7e8f90a1b2', name: 'tech-blog', createdAt: '2026-10-01T09:00:00Z' },
];

/** A picture for the sample pages, served by the mock so that it is a real http image. */
export const SAMPLE_IMAGE =
  '<svg xmlns="http://www.w3.org/2000/svg" width="312" height="130" viewBox="0 0 312 130"><rect width="312" height="130" fill="#e9effd"/><g fill="none" stroke="#5a6f96" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" transform="translate(136 49)"><rect x="0" y="0" width="40" height="32" rx="4"/><circle cx="10" cy="10" r="3"/><path d="M40 24 28 13 8 32"/></g></svg>';

const EXTRA_PENDING: Record<
  number,
  Pick<Task, 'pendingReason' | 'pendingRequestId' | 'pendingChoices'>
> = {
  11: {
    pendingReason: 'Waiting for a decision on how to order the task moves.',
    pendingRequestId: '11111111111111111111111111111111',
    pendingChoices: [
      { id: 'fifo', label: 'Keep the order they were moved in' },
      { id: 'priority', label: 'Sort by priority' },
    ],
  },
  13: {
    pendingReason: 'Waiting for confirmation on which display to check.',
    pendingRequestId: '13131313131313131313131313131313',
    pendingChoices: [
      { id: 'board', label: 'The board view' },
      { id: 'archive', label: 'The archive view' },
    ],
  },
};

function asBoard(project: Project, tasks: Task[]): MockBoard {
  return { project, revision: 1, epics: [SAMPLE_EPIC], problems: [], tasks };
}

/** A card with a long Markdown description, to try the description rendering with sample data. */
function longMarkdownTask(tasks: Task[], description: string): Task {
  const template = tasks[0] as Task;
  const id = Math.max(...tasks.map((task) => task.id)) + 1;
  return {
    ...template,
    id,
    title: 'Long Markdown description',
    description,
    taskStatus: 'todo',
    agentStatus: 'idle',
    pendingReason: null,
    pendingRequestId: null,
    isDraft: false,
    position: tasks.filter((task) => task.taskStatus === 'todo').length + 1,
  };
}

/** The sample boards by project ID, made fresh from `seed` each time. */
export function sampleBoards(seed: MockSeed): Record<string, MockBoard> {
  // A deep copy, so a board changed by the mock never changes the seed it was made from.
  const fixtureTasks = structuredClone(seed.fixture.tasks);
  const withEpic = (tasks: Task[]): Task[] =>
    tasks.map((task) => {
      const conditions = SAMPLE_CONDITIONS[task.id];
      // Card 16 has a frontmatter that cannot be read: its body is shown whole, with a notice.
      const broken =
        task.id === 16
          ? {
              ...task,
              body: "---\nacceptance:\n  - id: AC-1\n    text: ''\n---\n\nThe body stays visible.\n",
              acceptance: [],
              acceptanceError: true,
            }
          : task;
      const withConditions = conditions
        ? { ...broken, acceptance: structuredClone(conditions) }
        : broken;
      // Cards 11 and 13 also wait for an answer, so the Doing lane shows several pending cards at once.
      const extraPending = EXTRA_PENDING[task.id];
      const pending: Task = extraPending
        ? { ...withConditions, agentStatus: 'pending', ...structuredClone(extraPending) }
        : withConditions;
      return SAMPLE_EPIC_TASKS.includes(task.id)
        ? {
            ...pending,
            epic: { id: SAMPLE_EPIC.id, name: SAMPLE_EPIC.name, color: SAMPLE_EPIC.color },
          }
        : pending;
    });
  const [first, second, third] = SAMPLE_PROJECTS as [Project, Project, Project];
  return {
    [first.id]: asBoard(
      first,
      withEpic([...fixtureTasks, longMarkdownTask(fixtureTasks, seed.longMarkdown)]),
    ),
    [second.id]: asBoard(second, withEpic(structuredClone(fixtureTasks.slice(0, 3)))),
    [third.id]: asBoard(third, []),
  };
}
