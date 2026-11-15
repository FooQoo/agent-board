import { useState, useSyncExternalStore } from 'react';
import { AnswerBook } from '../../../features/tasks/answer/model/answerBook';

/**
 * What a screen needs to know of a book of held answers: `sending` holds the list still while
 * answers are on their way, and `held` keeps a build reload from dropping them. The screen
 * redraws when the book changes.
 */
export function useAnswerBookState(book: AnswerBook) {
  useSyncExternalStore(book.subscribe, book.revision);
  const sending = book.projectsWithUnsent().some((projectId) => book.sending(projectId));
  return { sending, held: book.hasAnyHeld() };
}

/** The monitor's own book of held answers. It lives as long as the page. */
export function useMonitorInteractions() {
  const [book] = useState(() => new AnswerBook());
  return { book, ...useAnswerBookState(book) };
}
