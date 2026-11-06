import { Suspense, useMemo } from 'react';
import { preloadable } from '@/shared/lib/lazy/preloadable';
import type { AttachmentResolver } from '@/shared/markdown/model';
import './decision-answer.css';

/** The Markdown renderer loads after the first screen; the question shows as plain text until then. */
const blocksView = preloadable(() =>
  import('@/shared/markdown/MarkdownBlocks').then((module) => module.MarkdownBlocks),
);

/** Fetches the renderer, so the question is usually drawn at once when the dialog opens. */
export function preloadDecisionQuestion(): Promise<unknown> {
  return blocksView.preload();
}

export interface DecisionQuestionProps {
  /** The question, in Markdown; nothing is drawn without one. */
  question: string | null;
  /** Turns an `attachment:<id>` image into its URL; null when the card has no such file. */
  resolveAttachment?: AttachmentResolver;
}

/** The question the agent asked, drawn as the task body is. */
export function DecisionQuestion({ question, resolveAttachment }: DecisionQuestionProps) {
  const blocks = useMemo(
    () => [{ id: 'question', kind: 'markdown' as const, source: question ?? '' }],
    [question],
  );
  if (question === null || question === '') return null;
  return (
    <div className="decision-question">
      <Suspense fallback={<p className="decision-question__plain">{question}</p>}>
        <blocksView.Component
          blocks={blocks}
          variant="wide"
          resolveAttachment={resolveAttachment}
        />
      </Suspense>
    </div>
  );
}
