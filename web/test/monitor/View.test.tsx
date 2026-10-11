import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { selectLocale } from '../../src/i18n';
import { MonitorView } from '../../src/monitor/View';
import type { MonitorViewProps } from '../../src/monitor/contracts';
import { makeCard, PROJECT_A, PROJECTS } from '../fixtures';

function props(): MonitorViewProps {
  const item = (
    id: number,
    cardStatus: 'todo' | 'doing' | 'done',
    agentStatus: 'idle' | 'running' | 'pending',
  ) => ({
    projectId: PROJECT_A.id,
    projectName: PROJECT_A.name,
    card: makeCard({
      id,
      cardStatus,
      agentStatus,
      pendingReason: agentStatus === 'pending' ? 'Waiting for decision' : null,
    }),
  });
  return {
    projects: PROJECTS,
    scope: 'all',
    summary: { todo: 1, doing: 3, done: 1 },
    todo: [item(1, 'todo', 'idle')],
    doing: [item(2, 'doing', 'running'), item(4, 'doing', 'pending'), item(5, 'doing', 'idle')],
    done: [item(3, 'done', 'idle')],
    freshness: {
      state: 'fresh',
      lastFetchedAt: '2026-10-11T00:00:00Z',
      failedProjectIds: [],
      snapshotProblems: [],
    },
    onScopeChange: vi.fn(),
    onRefresh: vi.fn(),
  };
}

describe('MonitorView', () => {
  beforeEach(() => selectLocale('en'));
  it('renders noninteractive lane groups and shows agent states only on Doing cards', () => {
    const { container } = render(<MonitorView {...props()} />);
    expect(container.querySelector('header.header')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Todo 1' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Doing 3' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Done 1' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: /Pending|Running/ })).toBeNull();
    const summary = screen.getByRole('region', { name: 'Work summary' });
    expect(within(summary).queryByRole('button', { name: /Pending|Running|Idle/ })).toBeNull();
    for (const id of [1, 3]) {
      const card = screen.getByRole('article', { name: new RegExp(`^#${id} `) });
      expect(card.querySelector('.status-label')).toBeNull();
      fireEvent.click(card);
      expect(card.hasAttribute('tabindex')).toBe(false);
    }
    const pendingCard = screen.getByRole('article', { name: /^#4 Doing Pending / });
    expect(pendingCard.querySelector('.status-label')?.textContent).toBe('Pending');
    expect(within(pendingCard).getByText('Waiting for decision')).toBeTruthy();
    expect(pendingCard.getAttribute('data-agent-status')).toBe('pending');
    expect(container.querySelectorAll('.monitor-card .status-label')).toHaveLength(3);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('button', { name: /Archive|Delete|Edit|Answer/ })).toBeNull();
  });

  it('changes lane labels and Doing agent-state badges together when the locale changes', () => {
    render(<MonitorView {...props()} />);
    const lanes = [
      { count: 1, en: 'Todo', ja: '未着手' },
      { count: 3, en: 'Doing', ja: '進行中' },
      { count: 1, en: 'Done', ja: '完了' },
    ];
    const states = [
      { id: 2, en: 'Running', ja: '稼働中' },
      { id: 4, en: 'Pending', ja: '待機中' },
      { id: 5, en: 'Idle', ja: '未稼働' },
    ];
    for (const locale of ['en', 'ja', 'en'] as const) {
      act(() => {
        selectLocale(locale);
      });
      const summary = screen.getByRole('region', {
        name: locale === 'ja' ? '作業の概要' : 'Work summary',
      });
      for (const lane of lanes) {
        const label = lane[locale];
        expect(
          within(summary).getByRole('button', { name: new RegExp(`^${lane.count}\\s*${label}$`) }),
        ).toBeTruthy();
        expect(screen.getByRole('heading', { name: `${label} ${lane.count}` })).toBeTruthy();
      }
      for (const state of states) {
        const label = state[locale];
        const card = screen.getByRole('article', { name: new RegExp(`^#${state.id} .*${label} `) });
        expect(card.querySelector('.status-label')?.textContent).toBe(label);
      }
      for (const id of [1, 3]) {
        expect(
          screen
            .getByRole('article', { name: new RegExp(`^#${id} `) })
            .querySelector('.status-label'),
        ).toBeNull();
      }
    }
  });
});
