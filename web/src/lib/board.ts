import type { Card, ColumnName } from '../types';

/** Groups cards by column in display order: Todo and Doing oldest first, Done newest first. */
export function groupCards(cards: Card[]): Record<ColumnName, Card[]> {
  const groups: Record<ColumnName, Card[]> = { todo: [], doing: [], done: [] };
  for (const card of cards) groups[card.column].push(card);
  groups.todo.sort((a, b) => a.position - b.position);
  groups.doing.sort((a, b) => a.position - b.position);
  groups.done.sort((a, b) => b.position - a.position);
  return groups;
}

export function findCard(cards: Card[], id: number | null): Card | null {
  if (id === null) return null;
  return cards.find((card) => card.id === id) ?? null;
}

/** Keeps the selection while the card exists; clears it once the card is gone. */
export function nextSelection(cards: Card[], selectedId: number | null): number | null {
  return findCard(cards, selectedId) ? selectedId : null;
}
