import { act, render, screen, within } from '@testing-library/react';
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
      pendingRequestId: agentStatus === 'pending' ? `request-${id}` : null,
      pendingChoices: agentStatus === 'pending' ? [{ id: 'choice', label: 'Continue' }] : [],
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
  it('lists each card once in its Todo, Doing, or Done lane', () => {
    const { container } = render(<MonitorView {...props()} />);
    expect(container.querySelector('header.header')).toBeTruthy();
    const headings = screen
      .getAllByRole('heading', { level: 2 })
      .map((h) => h.getAttribute('aria-label'));
    expect(headings).toEqual(['Todo 1', 'Doing 3', 'Done 1']);
    const summary = screen.getByRole('region', { name: 'Work summary' });
    for (const label of ['1Todo', '3Doing', '1Done']) {
      expect(within(summary).getByRole('button', { name: label })).toBeTruthy();
    }
    expect(screen.getAllByRole('article', { name: /^#4 / })).toHaveLength(1);
    const pendingCard = screen.getByRole('article', { name: /^#4 Doing Pending / });
    expect(pendingCard.querySelector('.status-label')?.textContent).toBe('Pending');
    expect(within(pendingCard).getByText('Waiting for decision')).toBeTruthy();
    expect(within(pendingCard).getByRole('textbox')).toBeTruthy();
    expect(
      (within(pendingCard).getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(pendingCard.getAttribute('data-agent-status')).toBe('pending');
    for (const id of [1, 3]) {
      const card = screen.getByRole('article', { name: new RegExp(`^#${id} `) });
      expect(card.querySelector('.status-label')).toBeNull();
      expect(
        (
          within(card).getByRole('button', {
            name: `Card ${id}`,
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(true);
    }
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('button', { name: /Archive|Delete|Edit/ })).toBeNull();
  });

  it('changes section and summary labels with the locale', () => {
    render(<MonitorView {...props()} />);
    const sections = [
      { en: 'Todo', ja: '未着手', count: 1 },
      { en: 'Doing', ja: '進行中', count: 3 },
      { en: 'Done', ja: '完了', count: 1 },
    ];
    const tiles = [
      { en: 'Todo', ja: '未着手', count: 1 },
      { en: 'Doing', ja: '進行中', count: 3 },
      { en: 'Done', ja: '完了', count: 1 },
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
          within(summary).getByRole('button', {
            name: new RegExp(`^${tile.count}\\s*${tile[locale]}$`),
          }),
        ).toBeTruthy();
      }
      for (const section of sections) {
        expect(
          screen.getByRole('heading', { name: `${section[locale]} ${section.count}` }),
        ).toBeTruthy();
      }
      const runningLabel = locale === 'ja' ? '稼働中' : 'Running';
      const running = screen.getByRole('article', { name: new RegExp(`^#2 .*${runningLabel} `) });
      expect(running.querySelector('.status-label')?.textContent).toBe(runningLabel);
    }
  });
});
