import type { Board, Card, Project } from '../src/types';
import boardJson from './fixtures/board.json';

export const fixtureBoard = boardJson as unknown as Board;

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
    version: `v${revision}`,
    cursor: `f1:${project.id}:v${revision}`,
    epics: [],
    cards,
    problems: [],
  };
}

export function fixtureCard(id: number): Card {
  const card = fixtureBoard.cards.find((c) => c.id === id);
  if (!card) throw new Error(`fixture card #${id} not found`);
  return structuredClone(card);
}

export function makeCard(overrides: Partial<Card> & Pick<Card, 'id'>): Card {
  const at = '2026-10-02T00:00:00Z';
  const description = overrides.description ?? '';
  return {
    title: `Card ${overrides.id}`,
    description,
    // Without frontmatter the body is the whole text.
    body: description,
    acceptance: [],
    acceptanceError: false,
    assignee: 'ai',
    cardStatus: 'todo',
    cardStatusChangedAt: at,
    position: 1,
    agentStatus: 'idle',
    pendingReason: null,
    pendingRequestId: null,
    pendingChoices: [],
    epic: null,
    createdAt: at,
    updatedAt: at,
    agentStatusChangedAt: at,
    isDraft: false,
    history: [{ at: at, reason: 'Created card in Todo.' }],
    attachments: [],
    evidence: [],
    ...overrides,
  };
}
