// Parsers of the Summary and the SSE `changed` payload. They accept exactly the contract's
// shape and throw `ContractError` for anything else, so a cache never holds a half-valid value.
import type {
  Change,
  ChangedEvent,
  Facet,
  Summary,
  SummaryEpic,
  SummaryProblem,
  SummaryTask,
} from './contracts';
import { bool, exact, fail, int, list, nullableStr, oneOf, str } from './guards';

const STATUSES = ['todo', 'doing', 'done'] as const;
const RUN_STATES = ['idle', 'running', 'pending'] as const;
const ASSIGNEES = ['ai', 'human'] as const;
const RESOURCES = ['task', 'epic', 'project'] as const;
const FACETS = ['summary', 'document', 'history', 'deleted'] as const;

const TASK_FIELDS = [
  'id',
  'title',
  'taskStatus',
  'agentStatus',
  'assignee',
  'isDraft',
  'position',
  'epicId',
  'acceptance',
  'updatedAt',
  'pendingRequestId',
  'pendingReason',
  'pendingChoices',
  'taskStatusChangedAt',
  'agentStatusChangedAt',
  'detailVersions',
];

function parseTask(value: unknown, path: string): SummaryTask {
  const o = exact(value, path, TASK_FIELDS, ['onboardingSample']);
  const acceptance = exact(o.acceptance, `${path}.acceptance`, ['done', 'total']);
  const versions = exact(o.detailVersions, `${path}.detailVersions`, ['document', 'history']);
  const task: SummaryTask = {
    id: int(o.id, `${path}.id`, 1),
    title: str(o.title, `${path}.title`),
    taskStatus: oneOf(o.taskStatus, `${path}.taskStatus`, STATUSES),
    agentStatus: oneOf(o.agentStatus, `${path}.agentStatus`, RUN_STATES),
    assignee: oneOf(o.assignee, `${path}.assignee`, ASSIGNEES),
    isDraft: bool(o.isDraft, `${path}.isDraft`),
    position: int(o.position, `${path}.position`, Number.MIN_SAFE_INTEGER),
    epicId: nullableStr(o.epicId, `${path}.epicId`),
    acceptance: {
      done: int(acceptance.done, `${path}.acceptance.done`),
      total: int(acceptance.total, `${path}.acceptance.total`),
    },
    updatedAt: str(o.updatedAt, `${path}.updatedAt`),
    pendingRequestId: nullableStr(o.pendingRequestId, `${path}.pendingRequestId`),
    pendingReason: nullableStr(o.pendingReason, `${path}.pendingReason`),
    pendingChoices: list(o.pendingChoices, `${path}.pendingChoices`, (v, p) => {
      const c = exact(v, p, ['id', 'label']);
      return { id: str(c.id, `${p}.id`), label: str(c.label, `${p}.label`) };
    }),
    taskStatusChangedAt: str(o.taskStatusChangedAt, `${path}.taskStatusChangedAt`),
    agentStatusChangedAt: str(o.agentStatusChangedAt, `${path}.agentStatusChangedAt`),
    detailVersions: {
      document: str(versions.document, `${path}.detailVersions.document`),
      history: str(versions.history, `${path}.detailVersions.history`),
    },
  };
  if (o.onboardingSample !== undefined) {
    const s = exact(o.onboardingSample, `${path}.onboardingSample`, ['runId', 'ordinal']);
    task.onboardingSample = {
      runId: str(s.runId, `${path}.onboardingSample.runId`),
      ordinal: int(s.ordinal, `${path}.onboardingSample.ordinal`, 1),
    };
  }
  return task;
}

function parseEpic(value: unknown, path: string): SummaryEpic {
  const o = exact(value, path, ['id', 'name', 'color', 'isDraft', 'progress', 'detailVersions']);
  const p = exact(o.progress, `${path}.progress`, ['todo', 'doing', 'done', 'archived', 'total']);
  const v = exact(o.detailVersions, `${path}.detailVersions`, ['document']);
  return {
    id: str(o.id, `${path}.id`),
    name: str(o.name, `${path}.name`),
    color: str(o.color, `${path}.color`),
    isDraft: bool(o.isDraft, `${path}.isDraft`),
    progress: {
      todo: int(p.todo, `${path}.progress.todo`),
      doing: int(p.doing, `${path}.progress.doing`),
      done: int(p.done, `${path}.progress.done`),
      archived: int(p.archived, `${path}.progress.archived`),
      total: int(p.total, `${path}.progress.total`),
    },
    detailVersions: { document: str(v.document, `${path}.detailVersions.document`) },
  };
}

function parseProblem(value: unknown, path: string): SummaryProblem {
  const o = exact(value, path, ['file', 'field', 'reason']);
  return {
    file: str(o.file, `${path}.file`),
    field: str(o.field, `${path}.field`),
    reason: str(o.reason, `${path}.reason`),
  };
}

/** The Summary response body, or a `ContractError`. */
export function parseSummary(value: unknown): Summary {
  const o = exact(value, 'summary', ['project', 'version', 'tasks', 'epics', 'problems']);
  const project = exact(o.project, 'summary.project', ['id', 'name']);
  return {
    project: {
      id: str(project.id, 'summary.project.id'),
      name: str(project.name, 'summary.project.name'),
    },
    version: str(o.version, 'summary.version'),
    tasks: list(o.tasks, 'summary.tasks', parseTask),
    epics: list(o.epics, 'summary.epics', parseEpic),
    problems: list(o.problems, 'summary.problems', parseProblem),
  };
}

function parseChange(value: unknown, path: string): Change {
  const o = exact(value, path, ['resource', 'id', 'facets']);
  const resource = oneOf(o.resource, `${path}.resource`, RESOURCES);
  const id = resource === 'task' ? int(o.id, `${path}.id`, 1) : str(o.id, `${path}.id`);
  const facets: Facet[] = list(o.facets, `${path}.facets`, (v, p) => oneOf(v, p, FACETS));
  if (facets.length === 0) fail(`${path}.facets`, 'at least one facet');
  if (new Set(facets).size !== facets.length) fail(`${path}.facets`, 'no repeated facet');
  if (resource === 'project' && facets.some((f) => f !== 'summary' && f !== 'deleted')) {
    fail(`${path}.facets`, 'only summary or deleted for a project');
  }
  return { resource, id, facets };
}

/** The data of an SSE `changed` event (a JSON object or its text), or a `ContractError`. */
export function parseChanged(input: unknown): ChangedEvent {
  let value = input;
  if (typeof input === 'string') {
    try {
      value = JSON.parse(input);
    } catch {
      fail('changed', 'JSON');
    }
  }
  const o = exact(value, 'changed', ['instanceId', 'seq', 'projectId', 'changes']);
  return {
    instanceId: str(o.instanceId, 'changed.instanceId'),
    seq: int(o.seq, 'changed.seq'),
    projectId: str(o.projectId, 'changed.projectId'),
    changes: list(o.changes, 'changed.changes', parseChange),
  };
}
