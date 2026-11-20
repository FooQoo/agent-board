import type { SessionHealth, SessionsSnapshot } from './api';

/** A project ID in the 32-hex form the routes accept. */
export const PROJECT = '0123456789abcdef0123456789abcdef';

export const stoppedHealth: SessionHealth = {
  tool: null,
  state: 'stopped',
  projectId: null,
  model: null,
  reason: null,
  waiting: false,
  backgroundTasks: [],
  pushStalled: [],
  restartCount: 0,
  lastExitAt: null,
  nextRestartAt: null,
  autoStart: null,
};

/** A health object with the given fields over the stopped one. */
export const health = (fields: Partial<SessionHealth>): SessionHealth => ({
  ...stoppedHealth,
  ...fields,
});

export const snapshotOf = (
  fields: Partial<SessionHealth>,
  options: Partial<Pick<SessionsSnapshot, 'sessions' | 'launched'>> = {},
): SessionsSnapshot => {
  const sessions = options.sessions ?? [];
  const external = sessions.filter((s) => s.origin === 'external').length;
  return {
    sessions,
    counts: {
      total: sessions.length,
      connected: sessions.length,
      byOrigin: { board: sessions.length - external, external },
    },
    launched: options.launched ?? [],
    health: health(fields),
  };
};
