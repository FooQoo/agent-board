import type { AutoStart, SessionHealth, SessionTool, SessionsSnapshot } from './api';

/** What the badge, the entry row and the footer say. `working` and `waiting` are the two running states. */
export type ResidentState = 'working' | 'waiting' | 'restarting' | 'stopped' | 'failed';

/** A problem with the chosen tool's CLI, read from the error code of a models or launch request. */
export type CliProblem = 'notFound' | 'notLoggedIn';

export const TOOLS: readonly SessionTool[] = ['claude-code', 'codex'];

const TOOL_NAMES: Record<SessionTool, string> = { 'claude-code': 'Claude Code', codex: 'Codex' };

/** The product name of a tool; it is not translated. */
export const toolName = (tool: SessionTool): string => TOOL_NAMES[tool];

/** Working on a task is a running session whose wait is not registered. */
export function deriveState(health: SessionHealth): ResidentState {
  if (health.state === 'running') return health.waiting ? 'waiting' : 'working';
  return health.state;
}

/** The launcher holds a process, or a restart is waiting. */
export const isActive = (state: ResidentState): boolean =>
  state === 'working' || state === 'waiting' || state === 'restarting';

/** The footer shows the indicator once something was launched, or while auto-start is on. */
export const footerVisible = (health: SessionHealth): boolean =>
  health.state !== 'stopped' || health.autoStart !== null;

/** A model value as the pickers keep it: the empty string is the tool's default. */
export const modelValue = (model: string | null | undefined): string =>
  model === null || model === undefined || model === 'default' ? '' : model;

export interface Choice {
  tool: SessionTool;
  model: string;
}

/** The tool and model the settings start from: the running session, else the saved auto-start. */
export function initialChoice(health: SessionHealth): Choice {
  if (health.tool) return { tool: health.tool, model: modelValue(health.model) };
  if (health.autoStart) {
    return { tool: health.autoStart.tool, model: modelValue(health.autoStart.model) };
  }
  return { tool: 'claude-code', model: '' };
}

/** The chosen tool or model differs from the running session: they apply from the next start. */
export const differsFromRunning = (health: SessionHealth, choice: Choice): boolean =>
  isActive(deriveState(health)) &&
  (choice.tool !== health.tool || choice.model !== modelValue(health.model));

/** Auto-start is on for this project (it is one choice in total, so another project's is not shown as on). */
export const autoStartIsOn = (autoStart: AutoStart | null, projectId: string): boolean =>
  autoStart !== null && autoStart.projectId === projectId;

/** The session runs for another project than the one this screen shows. */
export const isForOtherProject = (health: SessionHealth, projectId: string): boolean =>
  health.projectId !== null && health.projectId !== projectId;

export interface Attached {
  total: number;
  board: number;
  external: number;
}

export function attachedCounts(snapshot: SessionsSnapshot): Attached {
  const { board, external } = snapshot.counts.byOrigin;
  return { total: snapshot.counts.total, board, external };
}

/** The error codes that mean the CLI cannot start for a reason the person fixes in a terminal. */
export function cliProblemOf(code: string | null): CliProblem | null {
  if (code === 'agent_cli_missing') return 'notFound';
  if (code === 'agent_cli_logged_out') return 'notLoggedIn';
  return null;
}

/** Whole seconds until `nextRestartAt`, never negative; null without a time. */
export function secondsUntil(nextRestartAt: string | null, now: number): number | null {
  if (nextRestartAt === null) return null;
  const at = Date.parse(nextRestartAt);
  if (Number.isNaN(at)) return null;
  return Math.max(0, Math.ceil((at - now) / 1000));
}

/** When the launched session started, if the launcher reports it for this tool. */
export function startedAt(snapshot: SessionsSnapshot): string | null {
  const { tool, projectId } = snapshot.health;
  const found = snapshot.launched.find(
    (entry) => entry.tool === tool && entry.projectId === projectId,
  );
  return found?.startedAt ?? null;
}
