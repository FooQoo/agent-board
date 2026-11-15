import { Trash2Icon } from 'lucide-react';
import { type CSSProperties, type ReactNode, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { type CardGestureOptions, useCardGesture } from '../hooks/useCardGesture';
import { type MonitorSection, SECTION_ICONS } from './MonitorSectionHeader';
import { otherLanes, REVEAL_WIDTH, revealProgress } from '../model/lanes';

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
 * tiles for the two other lanes and the archive, each growing from a dot as the card narrows from
 * the right (its number and title stay in view, so the tiles always name the card they act on), and a
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
  const body = useRef<HTMLDivElement>(null);
  const restHeight = useRef<number | null>(null);
  // The card keeps the height it had when the finger came down while it narrows, so the cards
  // below do not jump. It is measured then, not on render, because the layout can settle later.
  const measureRest = () => {
    if (offset === 0 && body.current) restHeight.current = body.current.offsetHeight;
  };
  return (
    <div
      ref={ref}
      className="swipe-card"
      data-swipe-card={taskId}
      data-revealed={revealed || undefined}
      data-lifted={lifted || undefined}
      data-dragging={drag !== null || undefined}
      {...handlers}
      onPointerDownCapture={measureRest}
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
          const Icon = SECTION_ICONS[target];
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
      <div
        ref={body}
        className="swipe-card__body"
        style={
          offset < 0
            ? {
                width: `calc(100% - ${-offset}px)`,
                height: restHeight.current ?? undefined,
              }
            : undefined
        }
      >
        {children}
      </div>
    </div>
  );
}
