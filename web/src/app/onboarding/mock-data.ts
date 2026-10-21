import type { Project, ProjectId, Task } from '../../shared/api/contracts';

/** Sample data in the shape the board reads. The guide's samples are real cards, so the defaults match the product's. */
const RECENT_ISO = new Date().toISOString();

export function sampleProject(overrides: { name: string }): Project {
  return {
    id: 'project-onboarding-mock' as ProjectId,
    name: overrides.name,
    createdAt: RECENT_ISO,
  } as Project;
}

export function sampleTask(overrides: Partial<Task> & Pick<Task, 'id'>): Task {
  return {
    title: `Sample task ${overrides.id}`,
    description: '',
    body: '',
    acceptance: [],
    acceptanceError: false,
    assignee: 'ai',
    taskStatus: 'todo',
    taskStatusChangedAt: RECENT_ISO,
    position: 1,
    agentStatus: 'idle',
    pendingReason: null,
    pendingRequestId: null,
    pendingChoices: [],
    epic: null,
    createdAt: RECENT_ISO,
    updatedAt: RECENT_ISO,
    agentStatusChangedAt: RECENT_ISO,
    isDraft: false,
    history: [{ at: RECENT_ISO, reason: 'Created task in Todo.' }],
    attachments: [],
    ...overrides,
  };
}

export const SAMPLE_PROJECT = sampleProject({ name: 'agent-board' });
/** Recent enough that the cards show "just now", as in the approved mock. */
export const RECENT = RECENT_ISO;

export const samples = {
  follow: sampleTask({
    id: 1,
    title: 'サンプル：使い方を確認する',
    description: 'ガイド用のサンプルです。実際のAIは動きません。',
    taskStatus: 'todo',
    agentStatus: 'idle',
    assignee: 'ai',
    updatedAt: RECENT,
  }),
  style: sampleTask({
    id: 2,
    title: 'サンプル：案内の見せ方を選ぶ',
    description: 'ガイド用のサンプルです。実際のAIは動きません。',
    taskStatus: 'todo',
    agentStatus: 'idle',
    assignee: 'ai',
    updatedAt: RECENT,
  }),
};

export const runningSample = {
  ...samples.follow,
  taskStatus: 'doing' as const,
  agentStatus: 'running' as const,
};
export const doneSample = {
  ...samples.follow,
  taskStatus: 'done' as const,
  agentStatus: 'idle' as const,
};
export const pendingSample = {
  ...samples.style,
  taskStatus: 'doing' as const,
  agentStatus: 'pending' as const,
  pendingReason: '案内の文章は、どちらが読みやすいですか？',
  pendingRequestId: 'onboarding-sample-request',
  pendingChoices: [
    { id: 'brief', label: '短く、要点だけ' },
    { id: 'detailed', label: '背景も含めて詳しく' },
  ],
};
export const resumedSample = {
  ...samples.style,
  taskStatus: 'doing' as const,
  agentStatus: 'running' as const,
};
