import type { Board, Card } from '../src/types';
import boardJson from './fixtures/board.json';

export const fixtureBoard = boardJson as Board;

export function fixtureCard(id: number): Card {
  const card = fixtureBoard.cards.find((c) => c.id === id);
  if (!card) throw new Error(`fixture card #${id} not found`);
  return structuredClone(card);
}

export function makeCard(overrides: Partial<Card> & Pick<Card, 'id'>): Card {
  return {
    title: `Card ${overrides.id}`,
    description: '',
    column: 'todo',
    position: 1,
    run_state: 'idle',
    pending_reason: null,
    created_at: '2026-10-02T00:00:00Z',
    updated_at: '2026-10-02T00:00:00Z',
    run_state_changed_at: '2026-10-02T00:00:00Z',
    transitions: [{ from: null, to: 'todo', at: '2026-10-02T00:00:00Z' }],
    ...overrides,
  };
}
