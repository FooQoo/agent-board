import { useEffect, useState } from 'react';
import type { DetailTab } from './DetailTabs';

/**
 * The tab of the detail panel, and the tab a link asks for. A link to a result of the task, or to
 * its results as a whole, opens the results tab; a link to its history opens the history tab. The
 * panel opens on the linked tab, and opens it again when another link to the same task arrives.
 */
export function useLinkedTab(
  focusResultVersion: number | null,
  focusResults: boolean,
  focusHistory: boolean,
) {
  const results = focusResultVersion !== null || focusResults;
  const [tab, setTab] = useState<DetailTab>(
    results ? 'results' : focusHistory ? 'history' : 'description',
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: a link to another version asks again.
  useEffect(() => {
    if (results) setTab('results');
  }, [results, focusResultVersion]);
  useEffect(() => {
    if (focusHistory) setTab('history');
  }, [focusHistory]);
  return [tab, setTab] as const;
}
