// Synthetic data for Stories. Every value is fixed, so the same Story renders the same text, dates
// and order in every run. Each call returns new objects, so a Story can change its data freely.

import type { Epic, Project, Task } from '../../src/shared/api/contracts';
import type { MonitorTask } from '../../src/pages/monitor/contracts';

/**
 * The URL of the synthetic 96×64 PNG in `.storybook/static` (a blue and grey pattern, with no personal
 * or product content). Storybook and the browser tests both serve that folder from the root.
 */
export const SAMPLE_IMAGE_URL = '/sample-attachment.png';

/** The fixed clock of every Story, in UTC. */
export const FIXED_NOW = '2026-10-02T09:00:00.000Z';

export function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: '0f1e2d3c4b5a69788796a5b4c3d2e1f0',
    name: 'sample-project',
    createdAt: '2026-10-01T08:00:00.000Z',
    ...overrides,
  };
}

export function makeTask(overrides: Partial<Task> & Pick<Task, 'id'>): Task {
  const description = overrides.description ?? '';
  return {
    title: `Sample task ${overrides.id}`,
    description,
    // Without frontmatter, the body is the whole text.
    body: description,
    acceptance: [],
    acceptanceError: false,
    assignee: 'ai',
    taskStatus: 'todo',
    taskStatusChangedAt: FIXED_NOW,
    position: 1,
    agentStatus: 'idle',
    pendingReason: null,
    pendingRequestId: null,
    pendingChoices: [],
    epic: null,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    agentStatusChangedAt: FIXED_NOW,
    isDraft: false,
    history: [{ at: FIXED_NOW, reason: 'Created task in Todo.' }],
    attachments: [],
    ...overrides,
  };
}

export function makeEpic(overrides: Partial<Epic> = {}): Epic {
  return {
    id: 'e1a2b3c4d5e6f708192a3b4c5d6e7f80',
    name: 'Sample epic',
    color: '#3b82f6',
    isDraft: false,
    document: '# Sample epic\n\nA synthetic epic for Stories.',
    body: '# Sample epic\n\nA synthetic epic for Stories.',
    priority: [],
    priorityError: false,
    attachments: [],
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...overrides,
  };
}

/** A card as the monitor shows it: a copy of the task, with the project it belongs to. */
export function makeMonitorTask(task: Task, project: Project): MonitorTask {
  return { projectId: project.id, projectName: project.name, task: structuredClone(task) };
}
