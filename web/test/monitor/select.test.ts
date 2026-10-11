import { describe, expect, it } from 'vitest';
import { PROJECT_A, PROJECT_B, makeCard } from '../fixtures';
import { selectMonitorCards } from '../../src/monitor/model/select';
import type { MonitorCard } from '../../src/monitor/contracts';

const item = (
  projectId: string,
  id: number,
  cardStatus: 'todo' | 'doing' | 'done',
  agentStatus: 'idle' | 'running' | 'pending',
  archivedAt?: string,
): MonitorCard => ({
  projectId,
  projectName: projectId === PROJECT_A.id ? PROJECT_A.name : PROJECT_B.name,
  card: makeCard({ id, cardStatus, agentStatus, archivedAt, isDraft: true }),
});

describe('selectMonitorCards', () => {
  it('counts drafts as pending and status independently of lane, while excluding archived cards', () => {
    const result = selectMonitorCards(
      [
        item(PROJECT_A.id, 1, 'todo', 'pending'),
        item(PROJECT_A.id, 2, 'doing', 'running'),
        item(PROJECT_A.id, 3, 'done', 'idle'),
        item(PROJECT_A.id, 4, 'doing', 'idle'),
        item(PROJECT_A.id, 5, 'todo', 'pending', '2026-10-01T00:00:00Z'),
      ],
      'all',
    );
    expect(result.pending.map(({ card }) => card.id)).toEqual([1]);
    expect(result.running.map(({ card }) => card.id)).toEqual([2]);
    expect(result.done.map(({ card }) => card.id)).toEqual([3]);
  });

  it('limits the selected project without changing its grouping rules', () => {
    const result = selectMonitorCards(
      [item(PROJECT_A.id, 1, 'done', 'idle'), item(PROJECT_B.id, 2, 'todo', 'pending')],
      PROJECT_B.id,
    );
    expect(result.pending.map(({ card }) => card.id)).toEqual([2]);
    expect(result.done).toEqual([]);
  });
});
