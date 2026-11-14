import { useState } from 'react';
import type { ProjectId } from '@/shared/api/contracts';
import { sampleFor } from './decisionAnswerSamples';
import { AnswerBook } from './model/answerBook';
import type { AnswersWriter, BandQuestion, QuestionDetail, QuestionReader } from './model/qa';

/**
 * Sample questions for the Stories of the band, the dialog and the sheet: the five questions of the
 * approved mock (DELEGATE-1), in both languages. The second one is the decision sample with its
 * table, picture and code.
 */
export interface SampleQuestion extends BandQuestion {
  question: string;
  choices: { id: string; label: string }[];
  /** The answer the held Stories give it. */
  held: { choiceId: string; text?: string };
}

export const SAMPLE_PROJECT = '0f1e2d3c4b5a69788796a5b4c3d2e1f0' as ProjectId;

/** The cards the questions belong to, with the titles of the mock. */
export function sampleCards(language: string): { id: number; title: string }[] {
  const ja = language.startsWith('ja');
  return [
    { id: 11, title: ja ? 'APIリファクタリング' : 'API refactor' },
    { id: 12, title: 'Restore a board from JSON' },
    { id: 14, title: 'Prepare the Windows build' },
    { id: 15, title: 'Write the setup guide' },
    { id: 16, title: 'Refine the empty board' },
  ];
}

/** `sheet`: the second question is the shorter one of the sheet's design. */
export function sampleQuestions(language: string, sheet = false): SampleQuestion[] {
  const ja = language.startsWith('ja');
  const decision = sampleFor(language);
  return [
    {
      id: 'Q-1',
      title: ja ? '対象は CLI だけか、Web も含めるか' : 'Is it the CLI only, or the web too?',
      referencedBy: [],
      question: ja
        ? '## 対象は CLI だけか、Web も含めるか\n\n今回の変更を CLI だけにするか、Web の画面にも広げるかを決めてください。'
        : '## Is it the CLI only, or the web too?\n\nDecide whether this change covers the CLI only, or the web screens too.',
      choices: ja
        ? [
            { id: 'both', label: 'CLI と Web の両方を対象にする（推奨）' },
            { id: 'cli', label: 'CLI だけにする' },
          ]
        : [
            { id: 'both', label: 'Cover both the CLI and the web (recommended)' },
            { id: 'cli', label: 'The CLI only' },
          ],
      held: { choiceId: 'both' },
    },
    {
      id: 'Q-2',
      title: ja ? '破壊的変更の扱い' : 'How to handle the breaking change',
      referencedBy: [11],
      question: sheet ? decision.sheetQuestion : decision.question,
      choices: decision.choices,
      held: {
        choiceId: 'keep',
        text: ja ? 'v3 の公開までは残したいです。' : 'I want to keep it until v3 ships.',
      },
    },
    {
      id: 'Q-3',
      title: ja
        ? 'Windows 版を最初の計画に入れるか、それとも macOS 版を先に仕上げてから次の計画に回すか'
        : 'Should the Windows build be in the first plan, or should the macOS build be finished first and Windows wait for the next plan?',
      referencedBy: [14],
      question: ja
        ? '## Windows 版を最初の計画に入れるか、それとも macOS 版を先に仕上げてから次の計画に回すか\n\nWindows 版の作業は 2 週間ほどかかります。'
        : '## Should the Windows build be in the first plan?\n\nThe Windows build takes about two weeks.',
      choices: ja
        ? [
            { id: 'now', label: '最初の計画に入れる' },
            { id: 'next', label: '次の計画に回す' },
          ]
        : [
            { id: 'now', label: 'Put it in the first plan' },
            { id: 'next', label: 'Leave it for the next plan' },
          ],
      held: { choiceId: 'next' },
    },
    {
      id: 'Q-4',
      title: ja
        ? '復元時に既存のカードを上書きするか'
        : 'Should a restore overwrite the existing cards?',
      referencedBy: [12],
      question: ja
        ? '## 復元時に既存のカードを上書きするか\n\n同じ ID のカードがあるときの扱いを決めてください。'
        : '## Should a restore overwrite the existing cards?\n\nDecide what happens to a card with the same ID.',
      choices: ja
        ? [
            { id: 'overwrite', label: '上書きする' },
            { id: 'copy', label: '上書きせず、別のカードとして復元する' },
          ]
        : [
            { id: 'overwrite', label: 'Overwrite them' },
            { id: 'copy', label: 'Keep them, and restore as new cards' },
          ],
      held: { choiceId: 'copy' },
    },
    {
      id: 'Q-5',
      title: ja ? 'この計画で作業を始めてよいか' : 'May the work start with this plan?',
      referencedBy: [14, 15, 16],
      question: ja
        ? '## この計画で作業を始めてよいか\n\n#14・#15・#16 の計画ができました。'
        : '## May the work start with this plan?\n\nThe plan for #14, #15 and #16 is ready.',
      choices: ja
        ? [
            { id: 'approve', label: '承認して始める' },
            { id: 'revise', label: '計画を直す' },
          ]
        : [
            { id: 'approve', label: 'Approve and start' },
            { id: 'revise', label: 'Revise the plan' },
          ],
      held: { choiceId: 'approve' },
    },
  ];
}

/** Reads the sample questions as the routes would; an unknown one fails. */
export function sampleReader(questions: readonly SampleQuestion[]): QuestionReader {
  return async (_projectId, questionId) => {
    const found = questions.find((question) => question.id === questionId);
    if (!found) throw new Error(`No sample question ${questionId}.`);
    const detail: QuestionDetail = {
      id: found.id,
      question: found.question,
      choices: found.choices,
      recommendedChoiceId: found.choices[0]?.id ?? null,
      status: 'open',
      referencedBy: found.referencedBy,
    };
    return detail;
  };
}

/** A book with the first `count` sample questions answered, as after closing the dialog midway. */
export function sampleBook(questions: readonly SampleQuestion[], count: number): AnswerBook {
  const book = new AnswerBook();
  book.reconcile(SAMPLE_PROJECT, questions);
  for (const question of questions.slice(0, count)) {
    const choice = question.choices.find((item) => item.id === question.held.choiceId) ?? null;
    book.setChoice(SAMPLE_PROJECT, question.id, choice);
    if (question.held.text) book.setText(SAMPLE_PROJECT, question.id, question.held.text);
  }
  return book;
}

/** A writer that never answers, so a Story can show the sending state. */
export const pendingWriter: AnswersWriter = () => new Promise(() => {});

/** What a sample run starts with. */
export interface SampleFlowInput {
  /** How many of the questions have an answer held. */
  held: number;
  /** Questions answered or withdrawn elsewhere while the run was open. */
  closed?: { id: string; reason: 'answered' | 'withdrawn' }[];
  /** The sheet's shorter second question. */
  sheet?: boolean;
}

/** The sample questions, their reader, and a book holding the first answers, kept for the Story. */
export function useSampleQuestions(language: string, input: SampleFlowInput) {
  const [sample] = useState(() => {
    const questions = sampleQuestions(language, input.sheet);
    const book = sampleBook(questions, input.held);
    for (const closed of input.closed ?? [])
      book.markClosed(SAMPLE_PROJECT, closed.id, closed.reason);
    return { questions, book, read: sampleReader(questions), cards: sampleCards(language) };
  });
  return sample;
}
