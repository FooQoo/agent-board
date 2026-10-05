import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { BoardMessage } from '../../src/components/BoardMessage';
import { HistoryTimeline } from '../../src/components/HistoryTimeline';
import { Lane } from '../../src/components/Lane';
import { LaneHeader } from '../../src/components/LaneHeader';
import { StatusLabel } from '../../src/components/StatusLabel';
import { i18n } from '../../src/i18n';
import type { HistoryEvent } from '../../src/types';

afterEach(async () => {
  await i18n.changeLanguage('en');
});

describe('localized board content', () => {
  it('translates each lane label and its accessible region name', async () => {
    await i18n.changeLanguage('ja');
    render(<Lane column="todo" cards={[]} selectedId={null} onSelect={() => undefined} />);
    expect(screen.getByRole('region', { name: '未着手' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '未着手' })).toBeTruthy();
    expect(screen.getByText('0')).toBeTruthy();
  });

  it('translates column chips, lane headers, and run state badges', async () => {
    await i18n.changeLanguage('ja');
    const { rerender } = render(<StatusLabel kind="card" status="done" />);
    expect(screen.getByText('完了')).toBeTruthy();
    rerender(<LaneHeader column="doing" count={3} />);
    expect(screen.getByRole('heading', { name: '進行中' })).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
    rerender(<StatusLabel kind="agent" status="idle" />);
    expect(screen.getByText('未稼働')).toBeTruthy();
    rerender(<StatusLabel kind="agent" status="running" />);
    expect(screen.getByText('稼働中')).toBeTruthy();
    rerender(<StatusLabel kind="agent" status="pending" />);
    expect(screen.getByText('待機中')).toBeTruthy();
  });

  it('translates loading, error, retry, and empty board messages while retaining the CLI command', async () => {
    await i18n.changeLanguage('ja');
    const { rerender } = render(<BoardMessage kind="loading" />);
    expect(screen.getByText('読み込み中…')).toBeTruthy();
    rerender(<BoardMessage kind="error" onRetry={() => undefined} />);
    expect(screen.getByText('ボードを読み込めませんでした。')).toBeTruthy();
    expect(screen.getByRole('button', { name: '再試行' })).toBeTruthy();
    rerender(<BoardMessage kind="empty" />);
    expect(screen.getByText('カードはまだありません。')).toBeTruthy();
    expect(screen.getByText('「カード追加」から登録できます。')).toBeTruthy();
  });

  it('localizes only the creation marker in history and preserves order, columns, and timestamps', async () => {
    await i18n.changeLanguage('ja');
    const events: HistoryEvent[] = [
      {
        id: 1,
        kind: 'created',
        actor: 'ai',
        reason: null,
        fromCardStatus: null,
        toCardStatus: 'todo',
        fromAgentStatus: null,
        toAgentStatus: 'idle',
        requestId: null,
        at: '2026-10-01T16:00:00Z',
      },
      {
        id: 2,
        kind: 'lane',
        actor: 'human',
        reason: '着手',
        fromCardStatus: 'todo',
        toCardStatus: 'doing',
        fromAgentStatus: 'idle',
        toAgentStatus: 'idle',
        requestId: null,
        at: '2026-10-01T16:30:00Z',
      },
    ];
    const { container } = render(<HistoryTimeline events={events} />);
    expect(screen.getByText('未着手')).toBeTruthy();
    expect(screen.getByText('作成 · 10/01 16:00')).toBeTruthy();
    expect(screen.getByText('進行中')).toBeTruthy();
    expect(screen.getByText('10/01 16:30')).toBeTruthy();
    expect(
      [...container.querySelectorAll('.history__step')].map((step) =>
        step.getAttribute('data-column'),
      ),
    ).toEqual(['doing', 'todo']);
  });
});
