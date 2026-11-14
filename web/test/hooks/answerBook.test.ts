import { describe, expect, it, vi } from 'vitest';
import { AnswerBook } from '../../src/features/tasks/answer/model/answerBook';
import type { BandQuestion } from '../../src/features/tasks/answer/model/qa';
import { WriteError } from '../../src/shared/api/writeErrors';
import { PROJECT_A, PROJECT_B } from '../fixtures';

const q = (id: string, referencedBy: number[] = []): BandQuestion => ({
  id,
  title: `## Question ${id}`,
  referencedBy,
});
const keep = { id: 'keep', label: 'Keep it' };
const describeError = () => 'failed';

function bookWith(...ids: string[]) {
  const book = new AnswerBook();
  book.reconcile(
    PROJECT_A.id,
    ids.map((id) => q(id)),
  );
  return book;
}

describe('AnswerBook', () => {
  it('holds an answer per project and question, and tells the listeners', () => {
    const book = bookWith('Q-1', 'Q-2');
    const listener = vi.fn();
    book.subscribe(listener);
    book.setChoice(PROJECT_A.id, 'Q-1', keep);
    book.setText(PROJECT_A.id, 'Q-2', 'A note');
    expect(book.held(PROJECT_A.id, 'Q-1')).toEqual({
      choiceId: 'keep',
      choiceLabel: 'Keep it',
      text: '',
    });
    expect(book.held(PROJECT_B.id, 'Q-1')).toBeNull();
    expect(book.heldIds(PROJECT_A.id)).toEqual(['Q-1', 'Q-2']);
    expect(book.sendableIds(PROJECT_A.id)).toEqual(['Q-1', 'Q-2']);
    expect(book.projectsWithUnsent()).toEqual([PROJECT_A.id]);
    expect(listener).toHaveBeenCalledTimes(2);
    book.clear(PROJECT_A.id, 'Q-2');
    expect(book.heldIds(PROJECT_A.id)).toEqual(['Q-1']);
  });

  it('does not send a note over the limit, nor a question closed elsewhere', () => {
    const book = bookWith('Q-1', 'Q-2', 'Q-3');
    book.setText(PROJECT_A.id, 'Q-1', 'x'.repeat(2001));
    book.setChoice(PROJECT_A.id, 'Q-2', keep);
    book.setChoice(PROJECT_A.id, 'Q-3', keep);
    book.markClosed(PROJECT_A.id, 'Q-3', 'withdrawn');
    expect(book.sendableIds(PROJECT_A.id)).toEqual(['Q-2']);
    expect(book.closedReason(PROJECT_A.id, 'Q-3')).toBe('withdrawn');
  });

  it('marks a held question that leaves the open list, and returns it to be read', () => {
    const book = bookWith('Q-1', 'Q-2');
    book.setChoice(PROJECT_A.id, 'Q-1', keep);
    const left = book.reconcile(PROJECT_A.id, [q('Q-2')]);
    expect(left).toEqual(['Q-1']);
    expect(book.closedReason(PROJECT_A.id, 'Q-1')).toBe('gone');
    expect(book.sendableIds(PROJECT_A.id)).toEqual([]);
    // Reading it says why; the reason replaces "gone".
    book.markClosed(PROJECT_A.id, 'Q-1', 'answered');
    expect(book.closedReason(PROJECT_A.id, 'Q-1')).toBe('answered');
    expect(book.known(PROJECT_A.id, 'Q-1')?.title).toBe('## Question Q-1');
  });

  it('sends every sendable answer at once and forgets them when saved', async () => {
    const book = bookWith('Q-1', 'Q-2', 'Q-3');
    book.setChoice(PROJECT_A.id, 'Q-1', keep);
    book.setText(PROJECT_A.id, 'Q-2', '  Only a note  ');
    const write = vi.fn(async () => {});
    await expect(book.send(PROJECT_A.id, write, describeError)).resolves.toBe(true);
    expect(write).toHaveBeenCalledWith(PROJECT_A.id, [
      { questionId: 'Q-1', choiceId: 'keep' },
      { questionId: 'Q-2', text: '  Only a note  ' },
    ]);
    expect(book.heldIds(PROJECT_A.id)).toEqual([]);
    expect(book.isSent(PROJECT_A.id, 'Q-1')).toBe(true);
    expect(book.hasAnyHeld()).toBe(false);
    // Once the Summary no longer lists them, they are no longer counted as sent.
    book.reconcile(PROJECT_A.id, [q('Q-3')]);
    expect(book.isSent(PROJECT_A.id, 'Q-1')).toBe(false);
  });

  it('keeps the answers on a failure and marks the questions a conflict names', async () => {
    const book = bookWith('Q-1', 'Q-2');
    book.setChoice(PROJECT_A.id, 'Q-1', keep);
    book.setChoice(PROJECT_A.id, 'Q-2', keep);
    const conflict = new WriteError('conflict', 409, 'question_closed', null, {
      questionAnswered: ['Q-1'],
      questionWithdrawn: [],
    });
    await expect(
      book.send(PROJECT_A.id, () => Promise.reject(conflict), describeError),
    ).resolves.toBe(false);
    expect(book.failure(PROJECT_A.id)).toBe('failed');
    expect(book.closedReason(PROJECT_A.id, 'Q-1')).toBe('answered');
    expect(book.sendableIds(PROJECT_A.id)).toEqual(['Q-2']);
    expect(book.sending(PROJECT_A.id)).toBe(false);
  });

  it('does not send twice while a send is on its way', async () => {
    const book = bookWith('Q-1');
    book.setChoice(PROJECT_A.id, 'Q-1', keep);
    let finish = () => {};
    const write = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const first = book.send(PROJECT_A.id, write, describeError);
    expect(book.sending(PROJECT_A.id)).toBe(true);
    await expect(book.send(PROJECT_A.id, write, describeError)).resolves.toBe(false);
    finish();
    await expect(first).resolves.toBe(true);
    expect(write).toHaveBeenCalledTimes(1);
  });
});
