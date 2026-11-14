import { useState, useSyncExternalStore } from 'react';
import { AnswerBook } from '../../../features/tasks/answer/model/answerBook';

/**
 * The monitor's held answers. The book lives as long as the page; `sending` holds the list still
 * while answers are on their way, and `held` keeps a build reload from dropping them.
 */
export function useMonitorInteractions() {
  const [book] = useState(() => new AnswerBook());
  useSyncExternalStore(book.subscribe, book.revision);
  const sending = book.projectsWithUnsent().some((projectId) => book.sending(projectId));
  return { book, sending, held: book.hasAnyHeld() };
}
