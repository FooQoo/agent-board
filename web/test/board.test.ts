import { describe, expect, it } from 'vitest';
import { findCard, groupCards, nextSelection } from '../src/lib/board';
import { fixtureBoard, makeCard } from './fixtures';

const ids = (cards: { id: number }[]) => cards.map((c) => c.id);

describe('groupCards', () => {
  it('splits cards by column', () => {
    const groups = groupCards(fixtureBoard.cards);
    expect(ids(groups.todo)).toEqual([14, 15, 16]);
    expect(ids(groups.doing)).toEqual([11, 12, 13]);
    expect(ids(groups.done)).toEqual([9, 8]);
  });

  it('orders todo and doing by ascending position', () => {
    const groups = groupCards([
      makeCard({ id: 1, cardStatus: 'todo', position: 3 }),
      makeCard({ id: 2, cardStatus: 'todo', position: 1 }),
      makeCard({ id: 3, cardStatus: 'doing', position: 2 }),
      makeCard({ id: 4, cardStatus: 'doing', position: 1 }),
    ]);
    expect(ids(groups.todo)).toEqual([2, 1]);
    expect(ids(groups.doing)).toEqual([4, 3]);
  });

  it('orders done by descending position', () => {
    const groups = groupCards([
      makeCard({ id: 1, cardStatus: 'done', position: 1 }),
      makeCard({ id: 2, cardStatus: 'done', position: 3 }),
      makeCard({ id: 3, cardStatus: 'done', position: 2 }),
    ]);
    expect(ids(groups.done)).toEqual([2, 3, 1]);
  });

  it('returns empty lists for an empty board', () => {
    expect(groupCards([])).toEqual({ todo: [], doing: [], done: [] });
  });

  it('does not mutate its input', () => {
    const input = [makeCard({ id: 1, position: 2 }), makeCard({ id: 2, position: 1 })];
    groupCards(input);
    expect(ids(input)).toEqual([1, 2]);
  });
});

describe('findCard', () => {
  it('finds a card by id', () => {
    expect(findCard(fixtureBoard.cards, 12)?.title).toBe('Restore a board from JSON');
  });

  it('returns null for a missing id or no id', () => {
    expect(findCard(fixtureBoard.cards, 99)).toBeNull();
    expect(findCard(fixtureBoard.cards, null)).toBeNull();
  });
});

describe('nextSelection', () => {
  it('keeps a selection that still exists', () => {
    expect(nextSelection(fixtureBoard.cards, 8)).toBe(8);
  });

  it('returns null when the selected card is gone', () => {
    expect(nextSelection(fixtureBoard.cards, 99)).toBeNull();
  });

  it('returns null when nothing is selected', () => {
    expect(nextSelection(fixtureBoard.cards, null)).toBeNull();
  });
});
