import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DetailPanel } from '../../src/components/DetailPanel';
import { selectLocale } from '../../src/i18n';
import { fixtureCard, makeCard } from '../fixtures';

const noop = () => {};

describe('DetailPanel', () => {
  beforeEach(() => selectLocale('en'));

  it('translates the detail region, empty selection, headings, and accessible controls', () => {
    selectLocale('ja');
    const { rerender } = render(<DetailPanel card={null} onClose={noop} onDeleted={noop} />);
    expect(screen.getByRole('complementary', { name: 'カードの詳細' })).toBeTruthy();
    expect(screen.getByText('カードを選択すると詳細を表示します。')).toBeTruthy();

    rerender(<DetailPanel card={fixtureCard(12)} onClose={noop} onDeleted={noop} />);
    expect(screen.getByRole('button', { name: '詳細を閉じる' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'カードを削除' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '説明' })).toBeTruthy();
    expect(screen.getByText('説明はありません。')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '履歴' })).toBeTruthy();
    selectLocale('en');
  });

  it('asks for a selection when no card is selected', () => {
    render(<DetailPanel card={null} onClose={noop} onDeleted={noop} />);
    expect(screen.getByText('Select a card to see its details.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Delete card' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Close details' })).toBeNull();
  });

  it('shows the id, title, column, description and history of the selected card', () => {
    const { container } = render(
      <DetailPanel card={fixtureCard(8)} onClose={noop} onDeleted={noop} />,
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
    const { container } = render(<DetailPanel card={card} onClose={noop} onDeleted={noop} />);
    const description = container.querySelector('.detail__description');
    expect(description?.textContent).toBe('Line one\nLine **two**\n<b>three</b>');
    expect(container.querySelector('b')).toBeNull();
    expect(container.querySelector('strong')).toBeNull();
  });

  it('shows a note when the description is empty', () => {
    render(<DetailPanel card={fixtureCard(12)} onClose={noop} onDeleted={noop} />);
    expect(screen.getByText('No description.')).toBeTruthy();
  });

  it('draws one history point per event with the changed status and time', () => {
    const { container } = render(
      <DetailPanel card={fixtureCard(8)} onClose={noop} onDeleted={noop} />,
    );
    const steps = container.querySelectorAll('.history__step');
    expect(steps).toHaveLength(3);
    const texts = Array.from(steps).map((step) => step.textContent);
    expect(texts).toEqual([
      'DoneAI10/02 09:48Moved card',
      'DoingAI10/01 16:30Moved card',
      'TodoAICreated · 10/01 16:00',
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
    const { container } = render(<DetailPanel card={card} onClose={noop} onDeleted={noop} />);
    expect(container.querySelectorAll('.history__step')).toHaveLength(4);
  });

  it('shows the run state for a card in Doing and the reason for a pending card', () => {
    const { rerender } = render(
      <DetailPanel card={fixtureCard(11)} onClose={noop} onDeleted={noop} />,
    );
    expect(document.querySelector('.detail__meta .status-label--running')?.textContent).toBe(
      'Running',
    );
    rerender(<DetailPanel card={fixtureCard(12)} onClose={noop} onDeleted={noop} />);
    expect(document.querySelector('.detail__meta .status-label--pending')?.textContent).toBe(
      'Pending',
    );
    expect(screen.getAllByText('Waiting for confirmation on how to replace a board.')).toHaveLength(
      2,
    );
    rerender(<DetailPanel card={fixtureCard(8)} onClose={noop} onDeleted={noop} />);
    expect(screen.queryByText('Idle')).toBeNull();
  });

  it('closes with the Close details button', async () => {
    const onClose = vi.fn();
    render(<DetailPanel card={fixtureCard(8)} onClose={onClose} onDeleted={noop} />);
    await userEvent.click(screen.getByRole('button', { name: 'Close details' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders the panel as a labelled region', () => {
    render(<DetailPanel card={fixtureCard(8)} onClose={noop} onDeleted={noop} />);
    const region = screen.getByRole('complementary');
    expect(within(region).getByText('#8')).toBeTruthy();
  });
});
