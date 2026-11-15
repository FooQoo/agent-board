import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DecisionAnswerDialogContainer } from '../../src/features/tasks/answer/DecisionAnswerDialogContainer';
import { AnswerBook } from '../../src/features/tasks/answer/model/answerBook';
import type {
  AnswersWriter,
  BandQuestion,
  QuestionDetail,
  QuestionStatus,
} from '../../src/features/tasks/answer/model/qa';
import { type AnswerStart, answerStart } from '../../src/features/tasks/answer/answerStart';
import { selectLocale } from '../../src/shared/i18n';
import { WriteError } from '../../src/shared/api/writeErrors';
import { PROJECT_A } from '../fixtures';

const question = (id: string, title: string, referencedBy: number[]): BandQuestion => ({
  id,
  title: `## ${title}`,
  referencedBy,
});
const QUESTIONS = [
  question('Q-1', 'Which data to keep', [12]),
  question('Q-2', 'May the work start', [14, 15]),
  question('Q-3', 'Which platform first', []),
];
const TASKS = [
  { id: 12, title: 'Restore a board' },
  { id: 14, title: 'Prepare the build' },
  { id: 15, title: 'Write the guide' },
];
const CHOICES = [
  { id: 'yes', label: 'Yes' },
  { id: 'no', label: 'No' },
];

function reader(status: Record<string, QuestionStatus> = {}) {
  return vi.fn(async (_projectId: string, id: string): Promise<QuestionDetail> => {
    const found = QUESTIONS.find((item) => item.id === id) ?? question(id, `Question ${id}`, []);
    return {
      id,
      question: `${found.title}\n\nThe body of ${id}.`,
      choices: CHOICES,
      recommendedChoiceId: 'yes',
      status: status[id] ?? 'open',
      referencedBy: found.referencedBy,
    };
  });
}

interface Setup {
  start?: AnswerStart;
  questions?: BandQuestion[];
  write?: AnswersWriter;
  read?: ReturnType<typeof reader>;
  book?: AnswerBook;
}

function renderFlow({
  start = answerStart.resume(),
  questions = QUESTIONS,
  write = vi.fn(async () => {}),
  read = reader(),
  book = new AnswerBook(),
}: Setup = {}) {
  book.reconcile(PROJECT_A.id, questions);
  const onSent = vi.fn();
  const onClose = vi.fn();
  const view = (list: BandQuestion[]) => (
    <DecisionAnswerDialogContainer
      projectId={PROJECT_A.id}
      questions={list}
      tasks={TASKS}
      book={book}
      start={start}
      read={read}
      write={write}
      onSent={onSent}
      onClose={onClose}
    />
  );
  const utils = render(view(questions));
  return {
    ...utils,
    book,
    write,
    read,
    onSent,
    onClose,
    update: (list: BandQuestion[]) => utils.rerender(view(list)),
  };
}

const button = (name: string | RegExp) => screen.getByRole('button', { name });
const progress = () => within(screen.getByRole('navigation', { name: 'Answering progress' }));

beforeEach(() => selectLocale('en'));

describe('answering the questions in a row', () => {
  it('starts at the first question, shows the card and the position, and keeps answers between steps', async () => {
    renderFlow();
    expect(await screen.findByRole('dialog', { name: /Restore a board/ })).toBeTruthy();
    expect(screen.getByText('#12')).toBeTruthy();
    expect(screen.getByText('1 / 3')).toBeTruthy();
    expect(button('Previous')).toHaveProperty('disabled', true);
    await userEvent.click(await screen.findByRole('radio', { name: 'Yes' }));
    expect(screen.getByText('1 answered')).toBeTruthy();
    await userEvent.click(button('Next'));
    expect(await screen.findByText('2 / 3')).toBeTruthy();
    expect(screen.getByText('#14 #15')).toBeTruthy();
    // Several cards share the question: the heading counts them instead of naming the first.
    expect(screen.getByRole('dialog', { name: /2 tasks/ })).toBeTruthy();
    expect(screen.queryByText('Prepare the build')).toBeNull();
    await userEvent.click(button('Previous'));
    expect(await screen.findByRole('radio', { name: 'Yes' })).toHaveProperty('ariaChecked', 'true');
    // The progress marks the answered question and can jump to any step.
    expect(
      progress().getByRole('button', { name: /Which data to keep \(shown now\)/ }),
    ).toBeTruthy();
    await userEvent.click(progress().getByRole('button', { name: /Which platform first/ }));
    expect(await screen.findByText('3 / 3')).toBeTruthy();
    expect(screen.getByText('No task')).toBeTruthy();
  });

  it('opens only the question picked in the band, and sends it at once without a review', async () => {
    const book = new AnswerBook();
    book.reconcile(PROJECT_A.id, QUESTIONS);
    book.setChoice(PROJECT_A.id, 'Q-1', { id: 'no', label: 'No' });
    const { write, onSent, onClose } = renderFlow({
      start: answerStart.question('Q-2'),
      book,
    });
    expect(await screen.findByText('1 / 1')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Review and send' })).toBeNull();
    await userEvent.click(await screen.findByRole('radio', { name: 'Yes' }));
    await userEvent.click(button('Send'));
    await waitFor(() => expect(onSent).toHaveBeenCalledTimes(1));
    // The answer held for another question stays out of the send and stays held.
    expect(write).toHaveBeenCalledWith(PROJECT_A.id, [{ questionId: 'Q-2', choiceId: 'yes' }]);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(book.heldIds(PROJECT_A.id)).toEqual(['Q-1']);
  });

  it('lists the answers in the review and sends the answered ones together', async () => {
    const { write, onSent, onClose, book } = renderFlow();
    await userEvent.click(await screen.findByRole('radio', { name: 'No' }));
    await userEvent.click(button('Next'));
    await userEvent.type(await screen.findByRole('textbox', { name: 'Note' }), 'Only a note');
    await userEvent.click(progress().getByRole('button', { name: 'Review and send' }));
    expect(await screen.findByText('2 of 3 answered')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /^Change:/ })).toHaveLength(2);
    expect(button(/^Answer: Which platform first/)).toBeTruthy();
    await userEvent.click(button('Send all'));
    await waitFor(() => expect(onSent).toHaveBeenCalledTimes(1));
    expect(write).toHaveBeenCalledWith(PROJECT_A.id, [
      { questionId: 'Q-1', choiceId: 'no' },
      { questionId: 'Q-2', text: 'Only a note' },
    ]);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(book.heldIds(PROJECT_A.id)).toEqual([]);
  });

  it('keeps the answers when the send fails, and sends again from the review', async () => {
    const write = vi
      .fn<AnswersWriter>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(undefined);
    const book = new AnswerBook();
    book.reconcile(PROJECT_A.id, QUESTIONS);
    book.setChoice(PROJECT_A.id, 'Q-1', CHOICES[0] ?? null);
    const { onSent } = renderFlow({ start: answerStart.review(), write, book });
    await userEvent.click(await screen.findByRole('button', { name: 'Send all' }));
    expect(await screen.findByText('Could not save. Try again.')).toBeTruthy();
    expect(book.heldIds(PROJECT_A.id)).toEqual(['Q-1']);
    await userEvent.click(button('Send all'));
    await waitFor(() => expect(onSent).toHaveBeenCalledTimes(1));
    expect(write).toHaveBeenCalledTimes(2);
  });

  it('marks a question answered elsewhere and leaves it out of the send', async () => {
    const book = new AnswerBook();
    book.reconcile(PROJECT_A.id, QUESTIONS);
    book.setChoice(PROJECT_A.id, 'Q-1', CHOICES[0] ?? null);
    book.setChoice(PROJECT_A.id, 'Q-2', CHOICES[0] ?? null);
    const { update, write } = renderFlow({ start: answerStart.review(), book });
    // The Summary no longer lists Q-1; reading it says it was answered.
    act(() => {
      book.reconcile(PROJECT_A.id, QUESTIONS.slice(1));
      book.markClosed(PROJECT_A.id, 'Q-1', 'answered');
    });
    update(QUESTIONS.slice(1));
    expect(await screen.findByText(/This question was answered elsewhere/)).toBeTruthy();
    expect(screen.getByText('1 answered')).toBeTruthy();
    await userEvent.click(button('Send all'));
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    expect(write).toHaveBeenCalledWith(PROJECT_A.id, [{ questionId: 'Q-2', choiceId: 'yes' }]);
  });

  it('stops the input of a question the server reports as withdrawn', async () => {
    renderFlow({ read: reader({ 'Q-1': 'withdrawn' }) });
    expect(
      await screen.findByText('This question was withdrawn. You can no longer answer it.'),
    ).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Note' })).toHaveProperty('disabled', true);
  });

  it('adds a question that arrives during the run at the end', async () => {
    const { update } = renderFlow();
    await screen.findByText('1 / 3');
    update([...QUESTIONS, question('Q-4', 'One more thing', [12])]);
    expect(await screen.findByText('1 / 4')).toBeTruthy();
    expect(progress().getByRole('button', { name: /One more thing/ })).toBeTruthy();
  });

  it('shows the 409 conflict reason and keeps the others sendable', async () => {
    const conflict = new WriteError('conflict', 409, 'question_closed', null, {
      questionAnswered: [],
      questionWithdrawn: ['Q-2'],
    });
    const book = new AnswerBook();
    book.reconcile(PROJECT_A.id, QUESTIONS);
    book.setChoice(PROJECT_A.id, 'Q-1', CHOICES[0] ?? null);
    book.setChoice(PROJECT_A.id, 'Q-2', CHOICES[0] ?? null);
    renderFlow({ start: answerStart.review(), book, write: vi.fn().mockRejectedValue(conflict) });
    await userEvent.click(await screen.findByRole('button', { name: 'Send all' }));
    expect(
      await screen.findByText(/Some questions were answered or withdrawn elsewhere/),
    ).toBeTruthy();
    expect(book.sendableIds(PROJECT_A.id)).toEqual(['Q-1']);
  });

  it('keeps labels and buttons in Japanese', async () => {
    selectLocale('ja');
    renderFlow();
    await screen.findByRole('dialog');
    expect(button('次へ')).toBeTruthy();
    expect(button('前へ')).toBeTruthy();
    expect(
      screen.getByText('答えはまだ送られません。最後にまとめて確認して送ります。'),
    ).toBeTruthy();
  });
});
