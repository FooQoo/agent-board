import type { Task, ColumnName, Project } from '../types';
import type { MonitorTask, MonitorViewProps } from './contracts';

const project: Project = {
  id: 'a'.repeat(32),
  name: 'agent-board',
  createdAt: '2026-10-01T00:00:00Z',
};
const longText =
  'A detailed review of the read-only monitor layout, its stable navigation and shared task rendering. '.repeat(
    500,
  );

function taskMarkdown(body: string, acceptance: Task['acceptance'], history: Task['history']) {
  return `---\nacceptance: ${JSON.stringify(acceptance)}\nhistory: ${JSON.stringify(history)}\n---\n\n${body}`;
}

function task(id: number, status: ColumnName, long: boolean): Task {
  const at = `2026-10-11T00:${String(id % 60).padStart(2, '0')}:00Z`;
  const done = status === 'done';
  const agentStatus =
    status !== 'doing' ? 'idle' : id % 3 === 0 ? 'pending' : id % 2 === 0 ? 'running' : 'idle';
  const pending = agentStatus === 'pending';
  const body =
    long && id === 1
      ? longText
      : '## Work\n\nReview the monitor behavior and confirm the shared display remains read-only.\n\n## Acceptance\n\n- [x] Common detail view\n- [ ] Keep the content readable';
  const acceptance: Task['acceptance'] =
    id === 2
      ? [
          { id: 'AC-1', text: 'Shared display matches', done: true },
          { id: 'AC-2', text: 'Read-only in the monitor', done: false },
          { id: 'AC-3', text: 'Keeps the layout', done: false },
        ]
      : [];
  const history: Task['history'] = done
    ? [{ at: at, reason: 'Verified on the fixture' }]
    : [{ at: at, reason: 'Created task in Todo.' }];
  return {
    id,
    title:
      long && id === 1
        ? 'A monitor task title long enough to exercise the two line clamp at narrow widths'
        : `${status[0]?.toUpperCase()}${status.slice(1)} work item ${id}`,
    body: '',
    acceptance,
    acceptanceError: id === 5,
    description: taskMarkdown(body, acceptance, history),
    assignee: 'ai',
    taskStatus: status,
    taskStatusChangedAt: at,
    position: id,
    agentStatus,
    pendingReason: pending
      ? 'Waiting for a decision about how the mobile monitor should present the result.'
      : null,
    pendingRequestId: pending ? `request-${id}` : null,
    pendingChoices: pending
      ? [
          { id: 'a', label: 'Keep the current shared layout' },
          { id: 'b', label: 'Use a separate view' },
        ]
      : [],
    epic: null,
    createdAt: at,
    updatedAt: at,
    agentStatusChangedAt: at,
    isDraft: pending,
    history,
    attachments: [],
    evidence: [],
  };
}

export function createMonitorFixtureProps(): MonitorViewProps {
  const params = new URLSearchParams(window.location.search);
  const long = params.has('long');
  const ac1Fixture = params.get('fixture') === 'ac1';
  const count = ac1Fixture ? 11 : Math.min(100, Math.max(1, Number(params.get('count')) || 6));
  const scope = params.get('scope') ?? 'all';
  const items: MonitorTask[] = Array.from({ length: count }, (_, index) => {
    const id = index + 1;
    const status = ac1Fixture
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
    return {
      projectId: project.id,
      projectName: long
        ? `${project.name} project with an intentionally long name for one-line truncation`
        : project.name,
      task: task(id, status, long),
    };
  });
  const todo = items.filter((item) => item.task.taskStatus === 'todo');
  const doing = items.filter((item) => item.task.taskStatus === 'doing');
  const done = items.filter((item) => item.task.taskStatus === 'done');
  return {
    projects: [project],
    scope: scope === 'all' ? 'all' : project.id,
    summary: { todo: todo.length, doing: doing.length, done: done.length },
    todo,
    doing,
    done,
    freshness: {
      state: 'fresh',
      lastFetchedAt: '2026-10-11T01:00:00Z',
      failedProjectIds: [],
      snapshotProblems: [],
    },
    onScopeChange: () => undefined,
    onRefresh: () => undefined,
  };
}
