import { useState } from 'react';
import type { DecisionAnswerView } from './decisionAnswerView';

/** Sample text for the answer Stories: the design's own sentences, in both languages. */
export interface DecisionAnswerSample {
  title: string;
  question: string;
  longQuestion: string;
  choices: { id: string; label: string }[];
  note: string;
  failure: string;
}

const ATTACHMENT_ID = '0123456789abcdef0123456789abcdef';

/** The picture of the sample question: a file of the Storybook static folder. */
export function resolveSampleAttachment(id: string): string | null {
  return id === ATTACHMENT_ID ? '/sample-question.png' : null;
}

const ja: DecisionAnswerSample = {
  title: 'APIリファクタリング',
  question: `## 破壊的変更の扱い

v2 の応答から items を外すと、既存の連携が止まります。今の利用状況は次のとおりです。どこまで互換を残すかを決めてください。

| 利用元 | 呼び出し | 影響 |
| --- | --- | --- |
| CLI | 1 日 240 回 | 修正が必要 |
| モバイル | 1 日 80 回 | 影響なし |

![ボードの画面](attachment:${ATTACHMENT_ID})

\`\`\`
GET /api/v2/tasks
{ "items": [...], "next": null }
\`\`\`

互換を残すと、v3 まで 2 つの応答の形を保守します。移行期間を設ける場合は 2 週間を想定しています。`,
  longQuestion: '',
  choices: [
    { id: 'keep', label: '互換性を維持する（推奨）' },
    { id: 'allow', label: '破壊的変更を許可する' },
    { id: 'phase', label: '移行期間を設けて段階的に切り替える' },
  ],
  note: 'v3 の公開までは残したいです。CLI の修正は来週に回します。',
  failure: '保存できませんでした。もう一度お試しください。',
};

const en: DecisionAnswerSample = {
  title: 'API refactor',
  question: `## How to handle the breaking change

Removing items from the v2 response stops the existing integrations. Current usage is below. Decide how much compatibility to keep.

| Caller | Calls | Impact |
| --- | --- | --- |
| CLI | 240 a day | Needs a fix |
| Mobile | 80 a day | None |

![The board](attachment:${ATTACHMENT_ID})

\`\`\`
GET /api/v2/tasks
{ "items": [...], "next": null }
\`\`\`

Keeping compatibility means maintaining two response shapes until v3. A migration period would be about two weeks.`,
  longQuestion: '',
  choices: [
    { id: 'keep', label: 'Keep compatibility (recommended)' },
    { id: 'allow', label: 'Allow the breaking change' },
    { id: 'phase', label: 'Switch gradually over a migration period' },
  ],
  note: 'I want to keep it until v3 ships. The CLI fix can wait until next week.',
  failure: 'Could not save. Try again.',
};

const LONG_TAIL = Array.from(
  { length: 6 },
  (_, index) =>
    `### Option ${index + 1}\n\nA longer explanation of this option, so that the question needs more room than the dialog has. The left column scrolls by itself; the answer on the right stays where it is.`,
).join('\n\n');

ja.longQuestion = `${ja.question}\n\n${LONG_TAIL}`;
en.longQuestion = `${en.question}\n\n${LONG_TAIL}`;

/** The sample for the language of the Story (English unless it is Japanese). */
export function sampleFor(language: string): DecisionAnswerSample {
  return language.startsWith('ja') ? ja : en;
}

export interface SampleAnswerInput {
  choiceId?: string | null;
  /** The note of the sample, in the language of the Story. */
  note?: boolean;
  /** A note of the Story's own, when the sample's is not what it needs. */
  text?: string;
  phase?: DecisionAnswerView['phase'];
  notice?: DecisionAnswerView['notice'];
  failure?: string | null;
  tooLong?: boolean;
}

/** An answer that a Story can type into: the same fields the form state returns. */
export function useSampleAnswer(initial: SampleAnswerInput, sample: DecisionAnswerSample) {
  const [choiceId, setChoiceId] = useState<string | null>(initial.choiceId ?? null);
  const [text, setText] = useState(initial.text ?? (initial.note ? sample.note : ''));
  const phase = initial.phase ?? 'editing';
  const notice = initial.notice ?? null;
  const tooLong = initial.tooLong ?? false;
  const hasInput = choiceId !== null || text.trim() !== '';
  const disabled = phase === 'sending' || notice === 'withdrawn';
  const view: DecisionAnswerView = {
    choiceId,
    text,
    phase,
    notice,
    failure: initial.failure ?? (phase === 'failed' ? sample.failure : null),
    tooLong,
    sendable: hasInput && !disabled && !tooLong,
    disabled,
    hasInput,
  };
  return {
    view,
    onChoiceChange: setChoiceId,
    onTextChange: setText,
    onClear: () => {
      setChoiceId(null);
      setText('');
    },
  };
}
