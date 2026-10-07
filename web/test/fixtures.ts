import type { Board, Card, Project } from '../src/types';
import boardJson from './fixtures/board.json';

export const fixtureBoard = boardJson as Board;

export const PROJECT_A: Project = fixtureBoard.project;
export const PROJECT_B: Project = {
  id: 'b2c3d4e5f60718293a4b5c6d7e8f90a1',
  name: 'knowledge',
  createdAt: '2026-10-01T08:00:00Z',
};
export const PROJECT_C: Project = {
  id: 'c3d4e5f60718293a4b5c6d7e8f90a1b2',
  name: 'tech-blog',
  createdAt: '2026-10-01T09:00:00Z',
};
export const PROJECTS: Project[] = [PROJECT_A, PROJECT_B, PROJECT_C];

/** A board of `project` with `cards`. */
export function boardOf(project: Project, cards: Card[], revision = 1): Board {
  return {
    project,
    board: { name: project.name, createdAt: project.createdAt },
    revision,
    cursor: `${project.id}:${revision}`,
    cards,
  };
}

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
    isDraft: false,
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
