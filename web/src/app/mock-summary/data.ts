import { TITLES } from './fixture-text';

export interface SummaryResult {
  id: number;
  title: string;
}

export interface Summary {
  id: string;
  /** The hour the results were recorded in, as shown. */
  window: string;
  read: boolean;
  results: SummaryResult[];
}

export type SummarySet = 'empty' | 'mixed' | 'long';

const pick = (ja: boolean, ids: number[]): SummaryResult[] =>
  ids.map((id) => ({ id, title: TITLES[id]?.[ja ? 'ja' : 'en'] ?? '' }));

/** Fixed summaries, newest first. Only hours that recorded results exist. */
export function buildSummaries(set: SummarySet, ja: boolean): Summary[] {
  if (set === 'empty') return [];
  if (set === 'long') {
    return [
      {
        id: 's-long',
        window: '11/20 09:00–10:00',
        read: false,
        results: pick(ja, [548, 549, 550, 551, 552, 553, 555, 556, 557, 558, 563, 564]),
      },
      { id: 's-prev', window: '11/19 17:00–18:00', read: true, results: pick(ja, [552]) },
    ];
  }
  return [
    { id: 's1', window: '11/20 09:00–10:00', read: false, results: pick(ja, [552, 553, 556]) },
    { id: 's2', window: '11/20 07:00–08:00', read: false, results: pick(ja, [551]) },
    { id: 's3', window: '11/19 17:00–18:00', read: true, results: pick(ja, [549, 550]) },
    { id: 's4', window: '11/19 15:00–16:00', read: true, results: pick(ja, [548]) },
  ];
}

/** Open questions, for the Messages item of the bottom bar (questions only). */
export const OPEN_QUESTIONS = 2;
