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
  it('lists work the agent needs from the person first, then running work, then the lanes', () => {
    const { container } = render(<MonitorView {...props()} />);
    expect(container.querySelector('header.header')).toBeTruthy();
    const headings = screen
      .getAllByRole('heading', { level: 2 })
      .map((h) => h.getAttribute('aria-label'));
    expect(headings).toEqual([
      'Awaiting your decision 1',
      'Running work 1',
      'Todo 1',
      'Doing 1',
      'Done 1',
    ]);
    const summary = screen.getByRole('region', { name: 'Work summary' });
    for (const label of ['1Running', '1Pending', '1Done']) {
      expect(within(summary).getByRole('button', { name: label })).toBeTruthy();
    }
    expect(within(summary).queryByRole('button', { name: /Todo|Doing/ })).toBeNull();
    // A card is listed once: the pending card is not repeated in its lane.
    expect(screen.getAllByRole('article', { name: /^#4 / })).toHaveLength(1);
    const pendingCard = screen.getByRole('article', {
      name: /^#4 Awaiting your decision Pending /,
    });
    expect(pendingCard.querySelector('.status-label')?.textContent).toBe('Pending');
    expect(within(pendingCard).getByText('Waiting for decision')).toBeTruthy();
    expect(pendingCard.getAttribute('data-agent-status')).toBe('pending');
    for (const id of [1, 3]) {
      const card = screen.getByRole('article', { name: new RegExp(`^#${id} `) });
      expect(card.querySelector('.status-label')).toBeNull();
      fireEvent.click(card);
      expect(card.hasAttribute('tabindex')).toBe(false);
    }
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('button', { name: /Archive|Delete|Edit|Answer/ })).toBeNull();
  });

  it('changes section and summary labels with the locale', () => {
    render(<MonitorView {...props()} />);
    const sections = [
      { en: 'Awaiting your decision', ja: '判断待ち', count: 1 },
      { en: 'Running work', ja: 'Running の作業', count: 1 },
      { en: 'Todo', ja: '未着手', count: 1 },
      { en: 'Doing', ja: '進行中', count: 1 },
      { en: 'Done', ja: '完了', count: 1 },
    ];
    const tiles = [
      { en: 'Running', ja: '稼働中' },
      { en: 'Pending', ja: '待機中' },
      { en: 'Done', ja: '完了' },
    ];
    for (const locale of ['en', 'ja', 'en'] as const) {
      act(() => {
        selectLocale(locale);
      });
      const summary = screen.getByRole('region', {
        name: locale === 'ja' ? '作業の概要' : 'Work summary',
      });
      for (const tile of tiles) {
        expect(
          within(summary).getByRole('button', { name: new RegExp(`^1\\s*${tile[locale]}$`) }),
        ).toBeTruthy();
      }
      for (const section of sections) {
        expect(
          screen.getByRole('heading', { name: `${section[locale]} ${section.count}` }),
        ).toBeTruthy();
      }
      const runningLabel = tiles.find((tile) => tile.en === 'Running')?.[locale] ?? '';
      const running = screen.getByRole('article', { name: new RegExp(`^#2 .*${runningLabel} `) });
      expect(running.querySelector('.status-label')?.textContent).toBe(runningLabel);
    }
  });
});
