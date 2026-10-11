import { describe, expect, it } from 'vitest';
import { makeCard, PROJECT_A, PROJECT_B } from '../fixtures';
import type { MonitorCard } from '../../src/monitor/contracts';
import { completedAt, sortDone, sortLane } from '../../src/monitor/model/sort';

const item = (
  projectId: string,
  id: number,
  changed: string,
  history: MonitorCard['card']['history'] = [],
): MonitorCard => ({
  projectId,
  projectName: projectId === PROJECT_A.id ? PROJECT_A.name : PROJECT_B.name,
  card: makeCard({ id, agentStatusChangedAt: changed, updatedAt: '2099-01-01T00:00:00Z', history }),
});
const lane = (id: string, at: string, toCardStatus: 'todo' | 'done') => ({
  id,
  kind: 'lane' as const,
  actor: 'ai' as const,
  reason: null,
  fromCardStatus: 'todo' as const,
  toCardStatus,
  fromAgentStatus: null,
  toAgentStatus: 'idle' as const,
  requestId: null,
  at,
});

describe('monitor ordering', () => {
  it('preserves manual lane order within stable project groups, independently of run-state times', () => {
    const beta = item(PROJECT_B.id, 1, '2099-01-01T00:00:00Z');
    const first = item(PROJECT_A.id, 9, '2026-10-03T00:00:00Z');
    const second = item(PROJECT_A.id, 2, '2026-10-01T00:00:00Z');
    first.card.position = 1;
    second.card.position = 2;
    expect(sortLane([beta, second, first]).map(({ card }) => card.id)).toEqual([9, 2, 1]);
    second.card.position = 1;
    expect(sortLane([beta, first, second]).map(({ card }) => card.id)).toEqual([2, 9, 1]);
  });

  it('uses the last transition into Done, handles re-completion and leaves unknown timestamps last', () => {
    const older = item(PROJECT_A.id, 1, '2099-01-01T00:00:00Z', [
      lane('a', '2026-10-01T00:00:00Z', 'done'),
    ]);
    const reopened = item(PROJECT_A.id, 2, '2099-01-01T00:00:00Z', [
      lane('b', '2026-10-03T00:00:00Z', 'done'),
      lane('c', '2026-10-04T00:00:00Z', 'todo'),
      lane('d', '2026-10-05T00:00:00Z', 'done'),
    ]);
    const unknown = item(PROJECT_A.id, 3, '2099-01-01T00:00:00Z');
    expect(completedAt(reopened)).toBe('2026-10-05T00:00:00Z');
    expect(sortDone([unknown, older, reopened]).map(({ card }) => card.id)).toEqual([2, 1, 3]);
  });
});
