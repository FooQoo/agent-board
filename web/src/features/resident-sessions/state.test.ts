import { describe, expect, it } from 'vitest';
import { health, PROJECT, snapshotOf } from './fixtures';
import {
  attachedCounts,
  autoStartIsOn,
  cliProblemOf,
  deriveState,
  differsFromRunning,
  footerVisible,
  initialChoice,
  isActive,
  isForOtherProject,
  modelValue,
  secondsUntil,
  stalledItems,
  startedAt,
} from './state';

describe('deriveState', () => {
  it('is working while a running session is not waiting, and waiting once its wait is registered', () => {
    expect(deriveState(health({ state: 'running', waiting: false }))).toBe('working');
    expect(deriveState(health({ state: 'running', waiting: true }))).toBe('waiting');
  });

  it('passes the other launcher states through', () => {
    expect(deriveState(health({ state: 'restarting' }))).toBe('restarting');
    expect(deriveState(health({ state: 'failed' }))).toBe('failed');
    expect(deriveState(health({ state: 'stopped' }))).toBe('stopped');
  });

  it('counts working, waiting and restarting as active', () => {
    expect(['working', 'waiting', 'restarting'].every((s) => isActive(s as never))).toBe(true);
    expect(isActive('stopped')).toBe(false);
    expect(isActive('failed')).toBe(false);
  });
});

describe('footerVisible', () => {
  it('hides the indicator when nothing is launched and auto-start is off', () => {
    expect(footerVisible(health({}))).toBe(false);
  });

  it('shows it for any launched state, and while auto-start is saved', () => {
    expect(footerVisible(health({ state: 'running', tool: 'codex' }))).toBe(true);
    expect(footerVisible(health({ state: 'failed', tool: 'codex' }))).toBe(true);
    const autoStart = { tool: 'codex' as const, projectId: PROJECT, model: null };
    expect(footerVisible(health({ autoStart }))).toBe(true);
  });
});

describe('the chosen tool and model', () => {
  it('start from the running session, then from the saved auto-start, then from Claude Code', () => {
    expect(initialChoice(health({ state: 'running', tool: 'codex', model: 'gpt-5.4' }))).toEqual({
      tool: 'codex',
      model: 'gpt-5.4',
    });
    const autoStart = { tool: 'codex' as const, projectId: PROJECT, model: 'default' };
    expect(initialChoice(health({ autoStart }))).toEqual({ tool: 'codex', model: '' });
    expect(initialChoice(health({}))).toEqual({ tool: 'claude-code', model: '' });
  });

  it('read a missing or "default" model as the empty string', () => {
    expect(modelValue(null)).toBe('');
    expect(modelValue('default')).toBe('');
    expect(modelValue('opus')).toBe('opus');
  });

  it('differ from a running session only when the tool or model changes', () => {
    const running = health({ state: 'running', tool: 'claude-code', model: 'sonnet' });
    expect(differsFromRunning(running, { tool: 'claude-code', model: 'sonnet' })).toBe(false);
    expect(differsFromRunning(running, { tool: 'claude-code', model: '' })).toBe(true);
    expect(differsFromRunning(running, { tool: 'codex', model: 'sonnet' })).toBe(true);
    expect(differsFromRunning(health({}), { tool: 'codex', model: '' })).toBe(false);
  });
});

describe('the project of the session', () => {
  it('is on for auto-start only in the project that saved it', () => {
    const autoStart = { tool: 'codex' as const, projectId: PROJECT, model: null };
    expect(autoStartIsOn(autoStart, PROJECT)).toBe(true);
    expect(autoStartIsOn(autoStart, 'f'.repeat(32))).toBe(false);
    expect(autoStartIsOn(null, PROJECT)).toBe(false);
  });

  it('is another project when the launcher holds a different one', () => {
    expect(isForOtherProject(health({ projectId: 'f'.repeat(32) }), PROJECT)).toBe(true);
    expect(isForOtherProject(health({ projectId: PROJECT }), PROJECT)).toBe(false);
    expect(isForOtherProject(health({}), PROJECT)).toBe(false);
  });
});

describe('attached sessions', () => {
  it('count the board-launched and the external ones from the registry', () => {
    const snapshot = snapshotOf(
      {},
      {
        sessions: [
          {
            id: 'a',
            tool: 'codex',
            origin: 'external',
            connectedAt: '2026-11-19T01:00:00Z',
            lastSeenAt: '2026-11-19T01:00:00Z',
            state: 'connected',
          },
        ],
      },
    );
    expect(attachedCounts(snapshot)).toEqual({ total: 1, board: 0, external: 1 });
  });

  it('report when the launcher started the session', () => {
    const snapshot = snapshotOf(
      { state: 'running', tool: 'codex', projectId: PROJECT },
      {
        launched: [
          { tool: 'codex', projectId: PROJECT, model: null, startedAt: '2026-11-19T01:00:00Z' },
        ],
      },
    );
    expect(startedAt(snapshot)).toBe('2026-11-19T01:00:00Z');
    expect(
      startedAt(snapshotOf({ state: 'running', tool: 'claude-code', projectId: PROJECT })),
    ).toBeNull();
  });
});

describe('cliProblemOf', () => {
  it('maps the two CLI error codes and nothing else', () => {
    expect(cliProblemOf('agent_cli_missing')).toBe('notFound');
    expect(cliProblemOf('agent_cli_logged_out')).toBe('notLoggedIn');
    expect(cliProblemOf('session_launch_refused')).toBeNull();
    expect(cliProblemOf(null)).toBeNull();
  });
});

describe('secondsUntil', () => {
  const now = Date.parse('2026-11-19T03:00:00Z');

  it('rounds up to whole seconds and never goes below zero', () => {
    expect(secondsUntil('2026-11-19T03:00:04.200Z', now)).toBe(5);
    expect(secondsUntil('2026-11-19T02:59:00Z', now)).toBe(0);
  });

  it('is null without a usable time', () => {
    expect(secondsUntil(null, now)).toBeNull();
    expect(secondsUntil('soon', now)).toBeNull();
  });
});

describe('stalledItems', () => {
  it('splits the server sentence into the item and the last failure', () => {
    const items = stalledItems(
      health({
        pushStalled: [
          'request Q-3 was pushed 3 times and is still not handled (the last turn failed: boom).',
          'task 12 was pushed 3 times and is still not handled.',
          'something unexpected',
        ],
      }),
    );
    expect(items[0]).toMatchObject({ kind: 'request', id: 'Q-3', reason: 'boom' });
    expect(items[1]).toMatchObject({ kind: 'task', id: '12', reason: null });
    expect(items[2]).toMatchObject({ kind: null, id: null, text: 'something unexpected' });
  });
});
