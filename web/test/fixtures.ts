import type { Board, Card } from '../src/types';
import boardJson from './fixtures/board.json';

export const fixtureBoard = boardJson as Board;

export function fixtureCard(id: number): Card {
  const card = fixtureBoard.cards.find((c) => c.id === id);
  if (!card) throw new Error(`fixture card #${id} not found`);
  return structuredClone(card);
}

export function makeCard(overrides: Partial<Card> & Pick<Card, 'id'>): Card {
  const at = '2026-10-02T00:00:00Z';
  return {
    title: `Card ${overrides.id}`,
    description: '',
    assignee: 'ai',
    cardStatus: 'todo',
    position: 1,
    agentStatus: 'idle',
    pendingReason: null,
    pendingRequestId: null,
    createdAt: at,
    updatedAt: at,
    agentStatusChangedAt: at,
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
        at,
      },
    ],
    ...overrides,
  };
}
