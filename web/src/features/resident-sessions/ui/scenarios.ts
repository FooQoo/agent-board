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
          {
            kind: 'request',
            id: 'Q-3',
            attempts: 3,
            lastError: 'The turn ended without an answer',
          },
          { kind: 'answer', id: 'Q-5', attempts: 3, lastError: null },
          { kind: 'task', id: '12', attempts: 3, lastError: 'rate limited' },
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

const LOG_LINES = [
  '[agboard] resident session started (claude-code)',
  '> agboard wait',
  'Request R-12 received: "Add a retry to the upload step"',
  'Reading src/upload/client.ts',
  'Editing src/upload/client.ts: wrap send() in a three-attempt retry with backoff',
  'Running: cargo test upload::',
  'test upload::retries_on_timeout ... ok',
  'test upload::gives_up_after_three ... ok',
  'agboard task note 14 "Retry added; tests pass"',
  '> agboard wait',
];

/** The log pane's fixed reads for the stories: a running log, none yet, and one cut at its start. */
export const logs = {
  running: {
    data: {
      tool: 'claude-code' as const,
      exists: true,
      text: `${LOG_LINES.join('\n')}\n`,
      truncated: false,
      size: 640,
    },
    failed: false,
  },
  empty: {
    data: { tool: 'claude-code' as const, exists: false, text: '', truncated: false, size: 0 },
    failed: false,
  },
  truncated: {
    data: {
      tool: 'claude-code' as const,
      exists: true,
      text: `${[...LOG_LINES, ...LOG_LINES, ...LOG_LINES].join('\n')}\n`,
      truncated: true,
      size: 262144,
    },
    failed: false,
  },
  failed: {
    data: {
      tool: 'claude-code' as const,
      exists: true,
      text: `${LOG_LINES.join('\n')}\n`,
      truncated: false,
      size: 640,
    },
    failed: true,
  },
};
