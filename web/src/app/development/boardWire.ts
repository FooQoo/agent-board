import type { Board, Epic, Task } from '../../shared/api/contracts.ts';
import type { DetailEvent, DetailSection, Summary } from '../../shared/data/api/contracts.ts';

/**
 * Sample-data and test helpers: the Summary and the Detail streams a server would write for a
 * board snapshot. Only the sample-data server (`mock-api.ts`) and the tests import this module;
 * the production build does not.
 */

function digest(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 5381;
  for (let i = 0; i < text.length; i++) hash = ((hash * 33) ^ text.charCodeAt(i)) >>> 0;
  return hash.toString(16).padStart(8, '0');
}

const documentVersion = (task: Pick<Task, 'body' | 'acceptance' | 'attachments'>) =>
  digest({ body: task.body, acceptance: task.acceptance, attachments: task.attachments });
const historyVersion = (task: Pick<Task, 'history'>) => digest(task.history);
const epicVersion = (epic: Pick<Epic, 'body' | 'attachments'>) =>
  digest({ body: epic.body, attachments: epic.attachments });

export function summaryOfBoard(board: Board): Summary {
  const summary: Summary = {
    project: { id: board.project.id, name: board.project.name },
    version: '',
    tasks: board.tasks.map((task) => {
      const entry: Summary['tasks'][number] = {
        id: task.id,
        title: task.title,
        taskStatus: task.taskStatus,
        agentStatus: task.agentStatus,
        assignee: task.assignee,
        isDraft: task.isDraft,
        position: task.position,
        epicId: task.epic?.id ?? null,
        acceptance: {
          done: task.acceptance.filter((item) => item.done).length,
          total: task.acceptance.length,
        },
        acceptanceError: task.acceptanceError,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
        pendingRequestId: task.pendingRequestId,
        pendingReason: task.pendingReason,
        pendingChoices: task.pendingChoices,
        taskStatusChangedAt: task.taskStatusChangedAt,
        agentStatusChangedAt: task.agentStatusChangedAt,
        detailVersions: { document: documentVersion(task), history: historyVersion(task) },
      };
      if (task.onboardingSample) entry.onboardingSample = task.onboardingSample;
      return entry;
    }),
    epics: board.epics.map((epic) => ({
      id: epic.id,
      name: epic.name,
      color: epic.color,
      isDraft: epic.isDraft,
      priority: epic.priority,
      priorityError: epic.priorityError,
      progress: board.epicTaskCounts[epic.id] ?? {
        todo: 0,
        doing: 0,
        done: 0,
        archived: 0,
        total: 0,
      },
      detailVersions: { document: epicVersion(epic) },
    })),
    problems: board.problems,
  };
  summary.version = digest(summary);
  return summary;
}

/** The sections a Detail request names, in the contract's order. */
export function requestedSections(
  query: string | null,
  fallback: DetailSection[],
): DetailSection[] {
  const named = new URLSearchParams(query ?? '').get('sections');
  if (named === null) return fallback;
  const wanted = named.split(',');
  return (['document', 'history'] as const).filter((section) => wanted.includes(section));
}

export function taskDetailEvents(
  projectId: string,
  task: Task,
  sections: DetailSection[],
): DetailEvent[] {
  const versions = {
    ...(sections.includes('document') ? { document: documentVersion(task) } : {}),
    ...(sections.includes('history') ? { history: historyVersion(task) } : {}),
  };
  const events: DetailEvent[] = [
    { type: 'start', resource: 'task', id: task.id, projectId, sections, versions },
  ];
  if (sections.includes('document')) {
    events.push({ type: 'section-start', section: 'document' });
    events.push({ type: 'attachments', items: task.attachments });
    if (task.body !== '') events.push({ type: 'block', kind: 'markdown', text: task.body });
    for (const item of task.acceptance) events.push({ type: 'acceptance', ...item });
    events.push({
      type: 'section-end',
      section: 'document',
      count: (task.body !== '' ? 1 : 0) + task.acceptance.length,
    });
  }
  if (sections.includes('history')) {
    events.push({ type: 'section-start', section: 'history' });
    for (const item of task.history) events.push({ type: 'history-item', ...item });
    events.push({ type: 'section-end', section: 'history', count: task.history.length });
  }
  events.push({ type: 'complete', versions });
  return events;
}

export function epicDetailEvents(projectId: string, epic: Epic): DetailEvent[] {
  const versions = { document: epicVersion(epic) };
  const blocks: DetailEvent[] =
    epic.body !== '' ? [{ type: 'block', kind: 'markdown', text: epic.body }] : [];
  return [
    { type: 'start', resource: 'epic', id: epic.id, projectId, sections: ['document'], versions },
    { type: 'section-start', section: 'document' },
    { type: 'attachments', items: epic.attachments },
    ...blocks,
    { type: 'section-end', section: 'document', count: blocks.length },
    { type: 'complete', versions },
  ];
}

export const ndjson = (events: DetailEvent[]): string =>
  `${events.map((event) => JSON.stringify(event)).join('\n')}\n`;
