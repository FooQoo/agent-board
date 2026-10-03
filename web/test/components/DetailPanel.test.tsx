import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DetailPanel } from '../../src/components/DetailPanel';
import { fixtureCard, makeCard } from '../fixtures';

const noop = () => {};

describe('DetailPanel', () => {
  it('asks for a selection when no card is selected', () => {
    render(<DetailPanel card={null} onClose={noop} onDeleted={noop} />);
    expect(screen.getByText('Select a card to see its details.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Delete card' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Close details' })).toBeNull();
  });

  it('shows the id, title, column, description and history of the selected card', () => {
    render(<DetailPanel card={fixtureCard(8)} onClose={noop} onDeleted={noop} />);
    expect(screen.getByText('#8')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Initialize the board' })).toBeTruthy();
    expect(screen.getByText('Done', { selector: '.column-chip' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Description' })).toBeTruthy();
    expect(screen.getByText('Create the storage for the board with skan init.')).toBeTruthy();
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

  it('draws one history point per transition with the column name and time', () => {
    const { container } = render(<DetailPanel card={fixtureCard(8)} onClose={noop} onDeleted={noop} />);
    const steps = container.querySelectorAll('.history__step');
    expect(steps).toHaveLength(3);
    const texts = Array.from(steps).map((step) => step.textContent);
    expect(texts).toEqual(['TodoCreated · 10/01 16:00', 'Doing10/01 16:30', 'Done10/02 09:48']);
    expect(steps[0]?.getAttribute('data-column')).toBe('todo');
    expect(steps[2]?.getAttribute('data-column')).toBe('done');
  });

  it('adds a point when a card returned to an earlier column', () => {
    const card = makeCard({
      id: 32,
      column: 'doing',
      transitions: [
        { from: null, to: 'todo', at: '2026-10-01T16:00:00Z' },
        { from: 'todo', to: 'doing', at: '2026-10-01T16:30:00Z' },
        { from: 'doing', to: 'todo', at: '2026-10-01T17:00:00Z' },
        { from: 'todo', to: 'doing', at: '2026-10-01T18:00:00Z' },
      ],
    });
    const { container } = render(<DetailPanel card={card} onClose={noop} onDeleted={noop} />);
    expect(container.querySelectorAll('.history__step')).toHaveLength(4);
  });

  it('shows the run state for a card in Doing and the reason for a pending card', () => {
    const { rerender } = render(<DetailPanel card={fixtureCard(11)} onClose={noop} onDeleted={noop} />);
    expect(screen.getByText('Running')).toBeTruthy();
    rerender(<DetailPanel card={fixtureCard(12)} onClose={noop} onDeleted={noop} />);
    expect(screen.getByText('Pending')).toBeTruthy();
    expect(screen.getByText('Waiting for confirmation on how to replace a board.')).toBeTruthy();
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
