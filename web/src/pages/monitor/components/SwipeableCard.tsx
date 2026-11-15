import { ArchiveIcon } from 'lucide-react';
import { useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { type CardGestureOptions, useCardGesture } from '../hooks/useCardGesture';
import { REVEAL_WIDTH } from '../model/lanes';
import './monitor-lanes.css';

export interface SwipeableCardProps extends Omit<CardGestureOptions, 'disabled'> {
  taskId: number;
  /** The archive button was tapped; the parent opens the archive confirmation. */
  onArchive: () => void;
  /** The card is in a lane that is not on screen. */
  inactive?: boolean;
  children: ReactNode;
}

/**
 * Wraps a monitor card with the two things a finger does to it: a swipe to the left that reveals an
 * archive button, and a long press that lifts it to drag it into another lane. The card itself is
 * the child, so it keeps its own taps (the title opens the details). While the archive button is
 * showing, a tap on the card closes it instead.
 */
export function SwipeableCard({
  taskId,
  onArchive,
  inactive,
  children,
  revealed,
  ...gesture
}: SwipeableCardProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const { drag, lifted, consumesClick, handlers } = useCardGesture(ref, {
    ...gesture,
    revealed,
    disabled: inactive,
  });
  const offset = drag ?? (revealed ? -REVEAL_WIDTH : 0);
  return (
    <div
      ref={ref}
      className="swipe-card"
      data-swipe-card={taskId}
      data-revealed={revealed || undefined}
      data-lifted={lifted || undefined}
      data-dragging={drag !== null || undefined}
      {...handlers}
      onClickCapture={(event) => {
        // The click that ends a swipe or a lift is not a tap; a tap on a revealed card closes it.
        const target = event.target as Element;
        if (target.closest('[data-swipe-action]')) return;
        if (consumesClick() || revealed) {
          event.preventDefault();
          event.stopPropagation();
          if (revealed && !consumesClick()) gesture.onRevealChange(false);
        }
      }}
    >
      <div className="swipe-card__action" data-revealed={offset < 0 || undefined}>
        <button
          type="button"
          data-swipe-action
          className="swipe-card__button"
          tabIndex={revealed ? 0 : -1}
          aria-hidden={!revealed}
          aria-label={t('monitor.lanes.archiveTask', { id: taskId })}
          onClick={onArchive}
        >
          <ArchiveIcon aria-hidden="true" />
          <span>{t('archive.title')}</span>
        </button>
      </div>
      <div className="swipe-card__body" style={{ transform: `translateX(${offset}px)` }}>
        {children}
      </div>
    </div>
  );
}
