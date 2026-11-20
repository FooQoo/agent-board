import { Trash2Icon } from 'lucide-react';
import { type CSSProperties, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  actionsWidth,
  type RevealSide,
  revealOffset,
  revealProgress,
} from '@/shared/lib/gesture/cardReveal';
import { useCardGesture } from '@/shared/lib/gesture/useCardGesture';
import { type PeriodicSummary, windowLabel } from './model/messages';
import type { SummariesController } from './useSummaries';
import '@/shared/styles/swipe-card.css';
import './summary.css';

type Variant = 'dialog' | 'sheet';

function ResultList({ summary }: { summary: PeriodicSummary }) {
  const { t } = useTranslation();
  return (
    <ul className="summary-results" aria-label={t('messages.summary.resultsLabel')}>
      {summary.results.map((result, index) => (
        // A task can appear twice in a window (two results), so the position keeps the keys apart.
        <li key={`${result.taskId}-${index}`} className="summary-result">
          <span className="summary-result__id">#{result.taskId}</span>
          <span className="summary-result__title">{result.title}</span>
        </li>
      ))}
    </ul>
  );
}

interface ItemProps {
  summary: PeriodicSummary;
  variant: Variant;
  revealed: boolean;
  onReveal: (open: boolean) => void;
  onDismiss: () => void;
}

/**
 * One summary. On a phone it is the board card's own swipe: `useCardGesture` slides it left and
 * the trash tile grows from a dot, drawn with the card's `swipe-card__*` styles; a tap shows the
 * tile too. The gesture is always armed, so a sideways move that starts on an item belongs to the
 * item and never switches the tab. On a PC the trash button is always shown on the left.
 */
function SummaryItem({ summary, variant, revealed, onReveal, onDismiss }: ItemProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const side: RevealSide | null = revealed ? 'right' : null;
  const rightWidth = actionsWidth(1);
  const { drag, consumesClick, handlers } = useCardGesture(ref, {
    revealed: side,
    onRevealChange: (next) => onReveal(next === 'right'),
    armed: true,
    onArm: () => {},
    leftWidth: 0,
    rightWidth,
    disabled: variant !== 'sheet',
  });
  const offset = drag ?? revealOffset(side, 0, rightWidth);
  const label = windowLabel(summary.from, summary.to);
  const title = t('messages.summary.delete');

  const content = (
    <>
      {variant === 'sheet' ? (
        <button
          type="button"
          className="summary-item__head"
          onClick={() => {
            if (consumesClick()) return;
            onReveal(!revealed);
          }}
        >
          <span className="summary-item__window">{label}</span>
        </button>
      ) : (
        <div className="summary-item__head">
          <span className="summary-item__window">{label}</span>
        </div>
      )}
      <ResultList summary={summary} />
    </>
  );
  const itemProps = {
    className: 'summary-item',
    'data-variant': variant === 'sheet' ? 'phone' : 'desktop',
    'data-revealed': revealed || undefined,
  };

  if (variant === 'dialog') {
    return (
      <li {...itemProps}>
        <button
          type="button"
          className="summary-item__trash"
          aria-label={title}
          onClick={onDismiss}
        >
          <Trash2Icon aria-hidden="true" />
        </button>
        <div className="summary-item__body">{content}</div>
      </li>
    );
  }
  return (
    <li {...itemProps}>
      <div
        ref={ref}
        className="swipe-card"
        data-dragging={drag !== null || undefined}
        {...handlers}
      >
        <div
          className="swipe-card__actions"
          data-side="right"
          data-revealed={offset < 0 || undefined}
          style={
            {
              width: `${offset < 0 ? Math.min(rightWidth, Math.abs(offset)) : 0}px`,
              '--reveal': offset < 0 ? revealProgress(offset, rightWidth) : 0,
            } as CSSProperties
          }
        >
          <button
            type="button"
            data-swipe-action
            className="swipe-card__tile swipe-card__tile--archive"
            tabIndex={revealed ? 0 : -1}
            aria-hidden={!revealed}
            aria-label={title}
            onClick={onDismiss}
          >
            <Trash2Icon aria-hidden="true" />
          </button>
        </div>
        <div
          className="swipe-card__body summary-item__body"
          style={offset !== 0 ? { transform: `translateX(${offset}px)` } : undefined}
        >
          {content}
        </div>
      </div>
    </li>
  );
}

/** The Summary tab's page: the summaries not dismissed, each with its trash. */
export function SummaryList({
  controller,
  variant,
}: {
  controller: SummariesController;
  variant: Variant;
}) {
  const { t } = useTranslation();
  const [revealed, setRevealed] = useState<string | null>(null);
  const { summaries, loading, dismissFailed, dismiss } = controller;
  if (loading) return null;
  return (
    <>
      {dismissFailed && (
        <p className="summary-error" role="alert">
          {t('messages.summary.dismissFailed')}
        </p>
      )}
      {summaries.length === 0 ? (
        <div className="summary-empty">
          <p className="summary-empty__title">{t('messages.summary.emptyTitle')}</p>
          <p className="summary-empty__body">{t('messages.summary.emptyBody')}</p>
        </div>
      ) : (
        <ul className="summary-list" aria-label={t('messages.summary.itemsLabel')}>
          {summaries.map((summary) => (
            <SummaryItem
              key={summary.id}
              summary={summary}
              variant={variant}
              revealed={revealed === summary.id}
              onReveal={(open) => setRevealed(open ? summary.id : null)}
              onDismiss={() => {
                setRevealed(null);
                dismiss(summary.id);
              }}
            />
          ))}
        </ul>
      )}
    </>
  );
}
