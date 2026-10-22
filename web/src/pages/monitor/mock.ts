import type { ColumnName } from '../../shared/api/contracts';
import type { BlockKind, Summary, SummaryEpic, SummaryTask } from '../../shared/data/api';
import type { MonitorViewProps } from './contracts';
import { monitorFreshness } from './model/freshness';
import { monitorTasksOf } from './model/summary';

const PROJECT_ID = 'a'.repeat(32);
const PROJECT_NAME = 'agent-board';
const EPIC_ID = 'MOB-1';

interface FixtureBlock {
  kind: BlockKind;
  text: string;
}

interface FixtureTask {
  summary: SummaryTask;
  blocks: FixtureBlock[];
  acceptance: Array<{ id: string; text: string; done: boolean }>;
  history: Array<{ at: string; reason: string }>;
}

/** A project with cards, one epic and the text of each, as the server would hold it. */
export interface MonitorFixture {
  projectId: string;
  projectName: string;
  summary: Summary;
  tasks: Map<number, FixtureTask>;
  epicBlocks: FixtureBlock[];
}

const paragraph =
  'A detailed review of the read-only monitor layout, its stable navigation and shared task rendering.';

function bodyBlocks(long: boolean, id: number): FixtureBlock[] {
  const blocks: FixtureBlock[] = [
    {
      kind: 'markdown',
      text: '## Work\n\nReview the monitor behavior and confirm the shared display remains read-only.\n',
    },
    {
      kind: 'markdown',
      text: '## Acceptance\n\n- [x] Common detail view\n- [ ] Keep the content readable\n',
    },
  ];
  if (long && id === 1) {
    for (let index = 0; index < 60; index += 1) {
      blocks.push({ kind: 'markdown', text: `### Part ${index + 1}\n\n${paragraph.repeat(4)}\n` });
    }
  }
  return blocks;
}

function fixtureTask(id: number, status: ColumnName, long: boolean): FixtureTask {
  const at = `2026-10-11T00:${String(id % 60).padStart(2, '0')}:00Z`;
  const agentStatus =
    status !== 'doing' ? 'idle' : id % 3 === 0 ? 'pending' : id % 2 === 0 ? 'running' : 'idle';
  const pending = agentStatus === 'pending';
  const acceptance =
    id === 2
      ? [
          { id: 'AC-1', text: 'Shared display matches', done: true },
          { id: 'AC-2', text: 'Read-only in the monitor', done: false },
          { id: 'AC-3', text: 'Keeps the layout', done: false },
        ]
      : [];
  const history = [
    { at, reason: status === 'done' ? 'Verified on the fixture' : 'Created task in Todo.' },
  ];
  return {
    summary: {
      id,
      title:
        long && id === 1
          ? 'A monitor task title long enough to exercise the two line clamp at narrow widths'
          : `${status[0]?.toUpperCase()}${status.slice(1)} work item ${id}`,
      taskStatus: status,
      agentStatus,
      assignee: 'ai',
      isDraft: pending,
      position: id,
      epicId: id === 1 ? EPIC_ID : null,
      acceptance: { done: acceptance.filter((item) => item.done).length, total: acceptance.length },
      updatedAt: at,
      pendingRequestId: pending ? `request-${id}` : null,
      pendingReason: pending
        ? 'Waiting for a decision about how the mobile monitor should present the result.'
        : null,
      pendingChoices: pending
        ? [
            { id: 'a', label: 'Keep the current shared layout' },
            { id: 'b', label: 'Use a separate view' },
          ]
        : [],
      taskStatusChangedAt: at,
      agentStatusChangedAt: at,
      detailVersions: { document: `d${id}`, history: `h${id}` },
    },
    blocks: bodyBlocks(long, id),
    acceptance,
    history,
  };
}

/** The sample project the sample-data mode and the stories show. `?long`, `?count=` and `?fixture=ac1` shape it. */
export function createMonitorFixture(): MonitorFixture {
  const params = new URLSearchParams(window.location.search);
  const long = params.has('long');
  const ac1Fixture = params.get('fixture') === 'ac1';
  const count = ac1Fixture ? 11 : Math.min(100, Math.max(1, Number(params.get('count')) || 6));
  const tasks = new Map<number, FixtureTask>();
  for (let index = 0; index < count; index += 1) {
    const id = index + 1;
    const status: ColumnName = ac1Fixture
      ? id === 1
        ? 'todo'
        : id === 2 || id === 3
          ? 'doing'
          : 'done'
      : id === 3 || id % 7 === 0
        ? 'done'
        : id % 3 === 0
          ? 'doing'
          : 'todo';
    tasks.set(id, fixtureTask(id, status, long));
  }
  const epic: SummaryEpic = {
    id: EPIC_ID,
    name: 'Mobile work',
    color: '#4466aa',
    isDraft: false,
    progress: { todo: 1, doing: 0, done: 0, archived: 0, total: 1 },
    detailVersions: { document: 'e1' },
  };
  return {
    projectId: PROJECT_ID,
    projectName: long
      ? `${PROJECT_NAME} project with an intentionally long name for one-line truncation`
      : PROJECT_NAME,
    summary: {
      project: {
        id: PROJECT_ID,
        name: long
          ? `${PROJECT_NAME} project with an intentionally long name for one-line truncation`
          : PROJECT_NAME,
      },
      version: 'sv1',
      tasks: [...tasks.values()].map((task) => task.summary),
      epics: [epic],
      problems: [],
    },
    tasks,
    epicBlocks: [{ kind: 'markdown', text: 'Epic body text\n' }],
  };
}

/** The props of the list, as the screen builds them from the Summary. */
export function createMonitorFixtureProps(
  fixture: MonitorFixture = createMonitorFixture(),
): MonitorViewProps {
  const items = monitorTasksOf(fixture.summary);
  const by = (status: ColumnName) => items.filter((item) => item.task.taskStatus === status);
  const todo = by('todo');
  const doing = by('doing');
  const done = by('done');
  return {
    summary: { todo: todo.length, doing: doing.length, done: done.length },
    todo,
    doing,
    done,
    freshness: monitorFreshness({
      state: 'ready',
      hasData: true,
      problems: [],
      projectId: fixture.projectId,
      stream: 'connected',
      lastFetchedAt: '2026-10-11T01:00:00Z',
    }),
    onRefresh: () => undefined,
  };
}
