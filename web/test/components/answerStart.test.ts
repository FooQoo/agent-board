import { describe, expect, it } from 'vitest';
import { answerStart, runPlan } from '../../src/features/tasks/answer/answerStart';
import type { BandQuestion } from '../../src/features/tasks/answer/model/qa';

const question = (id: string, referencedBy: number[]): BandQuestion => ({
  id,
  title: `## ${id}`,
  referencedBy,
});
const OPEN = [
  question('Q-1', [12]),
  question('Q-2', [14, 15]),
  question('Q-3', [14]),
  question('Q-4', []),
];
const held = (start: ReturnType<typeof answerStart.resume>) =>
  OPEN.filter(runPlan(start).includes).map((item) => item.id);

describe('what a run holds, by how it starts', () => {
  it('a band item holds exactly its question, with no review', () => {
    const plan = runPlan(answerStart.question('Q-2'));
    expect(plan.direct).toBe(true);
    expect(held(answerStart.question('Q-2'))).toEqual(['Q-2']);
    expect(plan.opening).toEqual({ questionId: 'Q-2' });
  });

  it('a card holds exactly the questions of its task, with no review', () => {
    const plan = runPlan(answerStart.task(14));
    expect(plan.direct).toBe(true);
    expect(held(answerStart.task(14))).toEqual(['Q-2', 'Q-3']);
    expect(plan.opening).toEqual('firstOpen');
  });

  it('Answer them and Continue answering hold every question, with the review', () => {
    const plan = runPlan(answerStart.resume());
    expect(plan.direct).toBe(false);
    expect(held(answerStart.resume())).toEqual(['Q-1', 'Q-2', 'Q-3', 'Q-4']);
    expect(plan.opening).toEqual('firstOpen');
  });

  it('Review and send holds every question, and opens at the review', () => {
    const plan = runPlan(answerStart.review());
    expect(plan.direct).toBe(false);
    expect(held(answerStart.review())).toEqual(['Q-1', 'Q-2', 'Q-3', 'Q-4']);
    expect(plan.opening).toEqual('review');
  });
});
