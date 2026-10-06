import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DetailPanel } from '../../src/components/DetailPanel';
import { selectLocale } from '../../src/i18n';
import { PROJECT_A, fixtureCard, makeCard } from '../fixtures';

const noop = () => {};

describe('DetailPanel', () => {
  beforeEach(() => selectLocale('en'));

  it('translates the detail region, empty selection, headings, and accessible controls', () => {
    selectLocale('ja');
    const { rerender } = render(
      <DetailPanel projectId={PROJECT_A.id} card={null} onClose={noop} onDeleted={noop} />,
    );
    expect(screen.getByRole('complementary', { name: 'カードの詳細' })).toBeTruthy();
    expect(screen.getByText('カードを選択すると詳細を表示します。')).toBeTruthy();

    rerender(
      <DetailPanel
        projectId={PROJECT_A.id}
        card={fixtureCard(12)}
        onClose={noop}
        onDeleted={noop}
      />,
    );
    expect(screen.getByRole('button', { name: '詳細を閉じる' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'カードを削除' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '説明' })).toBeTruthy();
    expect(screen.getByText('説明はありません。')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '履歴' })).toBeTruthy();
    selectLocale('en');
  });

  it('asks for a selection when no card is selected', () => {
    render(<DetailPanel projectId={PROJECT_A.id} card={null} onClose={noop} onDeleted={noop} />);
    expect(screen.getByText('Select a card to see its details.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Delete card' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Close details' })).toBeNull();
  });

  it('shows the id, title, column, description and history of the selected card', () => {
    const { container } = render(
      <DetailPanel
        projectId={PROJECT_A.id}
        card={fixtureCard(8)}
        onClose={noop}
        onDeleted={noop}
      />,
    );
    expect(screen.getByText('#8')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Initialize the board' })).toBeTruthy();
    expect(container.querySelector('.detail__meta .status-label--done')?.textContent).toBe('Done');
    expect(screen.getByRole('heading', { name: 'Description' })).toBeTruthy();
    expect(screen.getByText('Create the storage for the board with agboard init.')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'History' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Close details' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete card' })).toBeTruthy();
  });

  it('keeps line breaks in the description and does not interpret markup', () => {
    const card = makeCard({ id: 31, description: 'Line one\nLine **two**\n<b>three</b>' });
    const { container } = render(
      <DetailPanel projectId={PROJECT_A.id} card={card} onClose={noop} onDeleted={noop} />,
    );
    const description = container.querySelector('.detail__description');
    expect(description?.textContent).toBe('Line one\nLine **two**\n<b>three</b>');
    expect(container.querySelector('b')).toBeNull();
    expect(container.querySelector('strong')).toBeNull();
  });

  it('shows a note when the description is empty', () => {
    render(
      <DetailPanel
        projectId={PROJECT_A.id}
        card={fixtureCard(12)}
        onClose={noop}
        onDeleted={noop}
      />,
    );
    expect(screen.getByText('No description.')).toBeTruthy();
  });

  it('draws one history point per event with the changed status and time', () => {
    const { container } = render(
      <DetailPanel
        projectId={PROJECT_A.id}
        card={fixtureCard(8)}
        onClose={noop}
        onDeleted={noop}
      />,
    );
    const steps = container.querySelectorAll('.history__step');
    expect(steps).toHaveLength(3);
    const texts = Array.from(steps).map((step) => step.textContent);
    expect(texts).toEqual([
      '10/02 09:48DoneMoved card',
      '10/01 16:30DoingMoved card',
      'Created · 10/01 16:00Todo',
    ]);
    expect(steps[0]?.getAttribute('data-column')).toBe('done');
    expect(steps[2]?.getAttribute('data-column')).toBe('todo');
  });

  it('adds a point when a card returned to an earlier column', () => {
    const card = makeCard({
      id: 32,
      cardStatus: 'doing',
      history: [
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
          actor: 'ai',
          reason: 'move',
          fromCardStatus: 'todo',
          toCardStatus: 'doing',
          fromAgentStatus: 'idle',
          toAgentStatus: 'idle',
          requestId: null,
          at: '2026-10-01T16:30:00Z',
        },
        {
          id: 3,
          kind: 'lane',
          actor: 'human',
          reason: 'move',
          fromCardStatus: 'doing',
          toCardStatus: 'todo',
          fromAgentStatus: 'idle',
          toAgentStatus: 'idle',
          requestId: null,
          at: '2026-10-01T17:00:00Z',
        },
        {
          id: 4,
          kind: 'lane',
          actor: 'ai',
          reason: 'move',
          fromCardStatus: 'todo',
          toCardStatus: 'doing',
          fromAgentStatus: 'idle',
          toAgentStatus: 'idle',
          requestId: null,
          at: '2026-10-01T18:00:00Z',
        },
      ],
    });
    const { container } = render(
      <DetailPanel projectId={PROJECT_A.id} card={card} onClose={noop} onDeleted={noop} />,
    );
    expect(container.querySelectorAll('.history__step')).toHaveLength(4);
  });

  it('shows the run state for a card in Doing and the reason for a pending card', () => {
    const { rerender } = render(
      <DetailPanel
        projectId={PROJECT_A.id}
        card={fixtureCard(11)}
        onClose={noop}
        onDeleted={noop}
      />,
    );
    expect(document.querySelector('.detail__meta .status-label--running')?.textContent).toBe(
      'Running',
    );
    rerender(
      <DetailPanel
        projectId={PROJECT_A.id}
        card={fixtureCard(12)}
        onClose={noop}
        onDeleted={noop}
      />,
    );
    expect(document.querySelector('.detail__meta .status-label--pending')?.textContent).toBe(
      'Pending',
    );
    expect(screen.getAllByText('Waiting for confirmation on how to replace a board.')).toHaveLength(
      2,
    );
    rerender(
      <DetailPanel
        projectId={PROJECT_A.id}
        card={fixtureCard(8)}
        onClose={noop}
        onDeleted={noop}
      />,
    );
    expect(screen.queryByText('Idle')).toBeNull();
  });

  it('closes with the Close details button', async () => {
    const onClose = vi.fn();
    render(
      <DetailPanel
        projectId={PROJECT_A.id}
        card={fixtureCard(8)}
        onClose={onClose}
        onDeleted={noop}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Close details' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders the panel as a labelled region', () => {
    render(
      <DetailPanel
        projectId={PROJECT_A.id}
        card={fixtureCard(8)}
        onClose={noop}
        onDeleted={noop}
      />,
    );
    const region = screen.getByRole('complementary');
    expect(within(region).getByText('#8')).toBeTruthy();
  });

  it('puts the time first, then the changed status with the actor, then the reason', () => {
    const { container } = render(
      <DetailPanel
        projectId={PROJECT_A.id}
        card={fixtureCard(8)}
        onClose={noop}
        onDeleted={noop}
      />,
    );
    const step = container.querySelector('.history__step') as HTMLElement;
    const parts = Array.from(step.querySelectorAll('.history__text > *')).map((el) => el.className);
    expect(parts).toEqual(['history__at', 'history__heading', 'history__reason']);
    expect(step.querySelector('.history__heading .status-label')).not.toBeNull();
    expect(step.querySelector('.history__heading .assignee-label')).not.toBeNull();
  });

  it('shows the status icons in the detail too and spins none of them outside the board', () => {
    const { container } = render(
      <DetailPanel
        projectId={PROJECT_A.id}
        card={fixtureCard(8)}
        onClose={noop}
        onDeleted={noop}
      />,
    );
    expect(container.querySelector('.detail__meta .status-label svg.lucide-check')).not.toBeNull();
    expect(container.querySelector('.detail__title')?.tagName).toBe('H2');
  });

  it('names the assignee next to the icon in the detail header', () => {
    const { container } = render(
      <DetailPanel
        projectId={PROJECT_A.id}
        card={fixtureCard(8)}
        onClose={noop}
        onDeleted={noop}
      />,
    );
    const meta = container.querySelector('.detail__meta') as HTMLElement;
    expect(meta.querySelector('.assignee-label')?.getAttribute('aria-label')).toBe('AI');
    expect(meta.querySelector('.detail__assignee')?.textContent).toBe('AI');
    expect(meta.querySelector('.detail__assignee')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('shows the pending request in a labelled box and keeps Answer and Delete in one row', () => {
    const card = fixtureCard(12);
    const { container } = render(
      <DetailPanel projectId={PROJECT_A.id} card={card} onClose={noop} onDeleted={noop} />,
    );
    const box = container.querySelector('.detail__pending') as HTMLElement;
    expect(box.textContent).toContain('Decision request from the AI');
    expect(box.textContent).toContain(card.pendingReason ?? 'missing');
    expect(box.querySelector('button')).toBeNull();
    const actions = container.querySelector('.detail__actions') as HTMLElement;
    const names = Array.from(actions.querySelectorAll('button')).map(
      (b) => b.textContent || b.getAttribute('aria-label'),
    );
    expect(names).toEqual(['Answer', 'Delete card']);
  });

  it('uses the shared Button for Delete and Cancel in the confirmation', async () => {
    render(
      <DetailPanel
        projectId={PROJECT_A.id}
        card={fixtureCard(8)}
        onClose={noop}
        onDeleted={noop}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Delete card' }));
    const group = screen.getByRole('group', { name: /^Delete #8/ });
    expect(within(group).getByRole('button', { name: 'Delete' }).getAttribute('data-variant')).toBe(
      'destructive',
    );
    expect(within(group).getByRole('button', { name: 'Cancel' }).getAttribute('data-variant')).toBe(
      'outline',
    );
  });

  it('colors a run state change dot by the new run state and other dots by the card status', () => {
    const ev = (
      id: number,
      kind: 'created' | 'lane' | 'agent',
      to: 'todo' | 'doing',
      agent: 'idle' | 'running' | 'pending',
    ) => ({
      id,
      kind,
      actor: 'ai' as const,
      reason: 'r',
      fromCardStatus: null,
      toCardStatus: to,
      fromAgentStatus: null,
      toAgentStatus: agent,
      requestId: null,
      at: `2026-10-01T1${id}:00:00Z`,
    });
    const card = makeCard({
      id: 33,
      cardStatus: 'doing',
      history: [
        ev(0, 'created', 'todo', 'idle'),
        ev(1, 'lane', 'doing', 'idle'),
        ev(2, 'agent', 'doing', 'running'),
        ev(3, 'agent', 'doing', 'pending'),
        ev(4, 'agent', 'doing', 'idle'),
      ],
    });
    const { container } = render(
      <DetailPanel projectId={PROJECT_A.id} card={card} onClose={noop} onDeleted={noop} />,
    );
    const tones = Array.from(container.querySelectorAll('.history__step .dot')).map((dot) =>
      dot.getAttribute('data-tone'),
    );
    // Newest first.
    expect(tones).toEqual(['idle', 'pending', 'doing', 'doing', 'todo']);
  });

  it('puts Delete at the left of the action row, directly after Answer when pending', () => {
    const { container, rerender } = render(
      <DetailPanel
        projectId={PROJECT_A.id}
        card={fixtureCard(8)}
        onClose={noop}
        onDeleted={noop}
      />,
    );
    const row = () => container.querySelector('.detail__actions') as HTMLElement;
    expect(
      Array.from(row().children).map((el) => el.textContent || el.getAttribute('aria-label')),
    ).toEqual(['Delete card', null]);
    rerender(
      <DetailPanel
        projectId={PROJECT_A.id}
        card={fixtureCard(12)}
        onClose={noop}
        onDeleted={noop}
      />,
    );
    expect(
      Array.from(row().children).map((el) => el.textContent || el.getAttribute('aria-label')),
    ).toEqual(['Answer', 'Delete card', null]);
  });
});
