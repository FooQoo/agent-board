import type { ModelOption, SessionsSnapshot } from '../api';
import { PROJECT, snapshotOf } from '../fixtures';
import type { ResidentPanelProps } from '../types';

/** Fixed data for the stories: the states of the approved design, with no API behind them. */
export const CLAUDE_MODELS: ModelOption[] = [
  { id: 'opus', label: 'Opus' },
  { id: 'sonnet', label: 'Sonnet' },
  { id: 'haiku', label: 'Haiku' },
  { id: 'fable', label: 'Fable' },
];

export const CODEX_MODELS: ModelOption[] = [
  { id: 'gpt-5.4', label: 'gpt-5.4' },
  { id: 'gpt-5.4-mini', label: 'gpt-5.4-mini' },
];

const external = {
  sessions: [
    {
      id: 'codex:external1',
      tool: 'codex' as const,
      origin: 'external' as const,
      connectedAt: '2026-11-19T01:03:00Z',
      lastSeenAt: '2026-11-19T01:10:00Z',
      state: 'connected' as const,
    },
  ],
};

const launched = (tool: 'claude-code' | 'codex', model: string | null) => ({
  launched: [{ tool, projectId: PROJECT, model, startedAt: '2026-11-19T00:12:00Z' }],
});

const noop = () => undefined;

const base = (snapshot: SessionsSnapshot): ResidentPanelProps => ({
  snapshot,
  projectId: PROJECT,
  choice: { tool: snapshot.health.tool ?? 'claude-code', model: snapshot.health.model ?? '' },
  models: { options: CLAUDE_MODELS, reason: null },
  pending: null,
  savingAuto: false,
  autoStart: snapshot.health.autoStart !== null,
  cliProblem: null,
  cliReason: null,
  launchProblem: null,
  problem: null,
  loadFailed: false,
  onTool: noop,
  onModel: noop,
  onStart: noop,
  onStop: noop,
  onAutoStart: noop,
  onCheckAgain: noop,
});

const autoStart = (tool: 'claude-code' | 'codex', model: string | null) => ({
  autoStart: { tool, projectId: PROJECT, model },
});

export type ScenarioId =
  | 'working'
  | 'waiting'
  | 'restarting'
  | 'nextStart'
  | 'stalled'
  | 'stopped'
  | 'failed'
  | 'cliMissing'
  | 'notLoggedIn'
  | 'modelsUnreadable'
  | 'starting'
  | 'launchError';

const working = snapshotOf(
  {
    state: 'running',
    tool: 'claude-code',
    projectId: PROJECT,
    model: 'sonnet',
    ...autoStart('claude-code', 'sonnet'),
  },
  { ...external, ...launched('claude-code', 'sonnet') },
);

const stopped = snapshotOf({}, {});
const codexStopped = {
  ...base(stopped),
  choice: { tool: 'codex' as const, model: '' },
  models: { options: CODEX_MODELS, reason: null },
};

export const scenarios: Record<ScenarioId, ResidentPanelProps> = {
  working: { ...base(working), choice: { tool: 'claude-code', model: 'sonnet' } },
  waiting: base(
    snapshotOf(
      { state: 'running', waiting: true, tool: 'codex', projectId: PROJECT, restartCount: 1 },
      { ...launched('codex', null) },
    ),
  ),
  restarting: base(
    snapshotOf(
      {
        state: 'restarting',
        tool: 'claude-code',
        projectId: PROJECT,
        model: 'sonnet',
        reason: 'The claude-code session exited (signal: 9 (SIGKILL)).',
        restartCount: 2,
        nextRestartAt: new Date(Date.now() + 8000).toISOString(),
      },
      { ...external },
    ),
  ),
  stalled: base(
    snapshotOf(
      {
        state: 'running',
        waiting: true,
        tool: 'claude-code',
        projectId: PROJECT,
        model: 'sonnet',
        pushStalled: [
          'request Q-3 was pushed 3 times and is still not handled (the last turn failed: The turn ended without an answer).',
          'answer Q-5 was pushed 3 times and is still not handled.',
          'task 12 was pushed 3 times and is still not handled (the last turn failed: rate limited).',
        ],
      },
      { ...launched('claude-code', 'sonnet') },
    ),
  ),
  nextStart: {
    ...base(working),
    choice: { tool: 'codex', model: '' },
    models: { options: CODEX_MODELS, reason: null },
  },
  stopped: codexStopped,
  failed: base(
    snapshotOf({
      state: 'failed',
      tool: 'codex',
      projectId: PROJECT,
      reason: 'The codex session exited 4 times within 2 minutes; the board stopped restarting it.',
      restartCount: 5,
    }),
  ),
  cliMissing: {
    ...base(stopped),
    cliProblem: 'notFound',
    cliReason: 'claude is not on the PATH of the server.',
    models: { options: [], reason: null },
  },
  notLoggedIn: {
    ...codexStopped,
    cliProblem: 'notLoggedIn',
    cliReason: 'Codex is not logged in. Run codex login in a terminal.',
  },
  modelsUnreadable: {
    ...codexStopped,
    models: { options: [], reason: 'codex printed no model list' },
  },
  starting: { ...base(stopped), pending: 'starting' },
  launchError: {
    ...base(stopped),
    launchProblem: {
      code: 'project_has_no_folder',
      reason:
        'The project has no bound folder that still exists. Bind one with agboard project bind.',
      unreachable: false,
    },
  },
};
