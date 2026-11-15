import { CheckIcon, CircleDashedIcon, CircleIcon, Trash2Icon } from 'lucide-react';
import { type CSSProperties, type ReactNode, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { type CardGestureOptions, useCardGesture } from '../hooks/useCardGesture';
import type { MonitorSection } from './MonitorSectionHeader';
import { otherLanes, REVEAL_WIDTH, revealProgress } from '../model/lanes';

const LANE_ICONS = { todo: CircleIcon, doing: CircleDashedIcon, done: CheckIcon } as const;
import './monitor-lanes.css';

export interface SwipeableCardProps extends Omit<CardGestureOptions, 'disabled'> {
  taskId: number;
  /** The lane the card is in; the swipe offers the other two. */
  lane: MonitorSection;
  /** A lane tile was tapped; the parent opens the move dialog. */
  onMove: (target: MonitorSection) => void;
  /** The trash tile was tapped; the parent opens the archive confirmation. */
  onArchive: () => void;
  /** The card is in a lane that is not on screen. */
  inactive?: boolean;
  children: ReactNode;
}

/**
 * Wraps a monitor card with the two things a finger does to it: a swipe to the left that reveals
 * tiles for the two other lanes and the archive, each growing from a dot as the card slides, and a
 * long press that lifts it to drag it into another lane. The card itself is
 * the child, so it keeps its own taps (the title opens the details). While the archive button is
 * showing, a tap on the card closes it instead.
 */
export function SwipeableCard({
  taskId,
  lane,
  onMove,
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
      <div
        className="swipe-card__actions"
        data-revealed={offset < 0 || undefined}
        style={
          {
            width: `${Math.max(0, -offset)}px`,
            '--reveal': revealProgress(offset),
          } as CSSProperties
        }
      >
        {otherLanes(lane).map((target) => {
          const Icon = LANE_ICONS[target];
          return (
            <button
              key={target}
              type="button"
              data-swipe-action
              data-target={target}
              className="swipe-card__tile"
              tabIndex={revealed ? 0 : -1}
              aria-hidden={!revealed}
              aria-label={t('monitor.lanes.moveTask', {
                id: taskId,
                lane: t(`monitor.status.${target}`),
              })}
              onClick={() => onMove(target)}
            >
              <Icon aria-hidden="true" />
            </button>
          );
        })}
        <button
          type="button"
          data-swipe-action
          data-target="archive"
          className="swipe-card__tile swipe-card__tile--archive"
          tabIndex={revealed ? 0 : -1}
          aria-hidden={!revealed}
          aria-label={t('monitor.lanes.archiveTask', { id: taskId })}
          onClick={onArchive}
        >
          <Trash2Icon aria-hidden="true" />
        </button>
      </div>
      <div className="swipe-card__body" style={{ transform: `translateX(${offset}px)` }}>
        {children}
      </div>
    </div>
  );
}
