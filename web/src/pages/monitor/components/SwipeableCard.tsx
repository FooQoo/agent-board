import { Trash2Icon } from 'lucide-react';
import { type CSSProperties, type ReactNode, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { type CardGestureOptions, useCardGesture } from '../hooks/useCardGesture';
import { type MonitorSection, SECTION_ICONS } from './MonitorSectionHeader';
import {
  actionsWidth,
  type RevealSide,
  revealOffset,
  revealProgress,
  swipeActions,
} from '../model/lanes';

import './monitor-lanes.css';

export interface SwipeableCardProps
  extends Omit<CardGestureOptions, 'disabled' | 'leftWidth' | 'rightWidth'> {
  taskId: number;
  /** The lane the card is in; a swipe offers the lanes beside it. */
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
 * Wraps a monitor card with what a finger does to it. Holding the card for a moment chooses it
 * (a focus ring shows); after that, a swipe to the left on it slides it left and shows the lane on
 * the right and the archive, and a swipe to the right shows the lane on the left. Each tile grows
 * from a dot as the card slides. The card itself is the child, so it keeps its own taps (the title
 * opens the details). While tiles are showing, a tap on the card closes them instead.
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
  const actions = swipeActions(lane);
  const leftWidth = actionsWidth(actions.left.length);
  const rightWidth = actionsWidth(actions.right.length);
  const { drag, consumesClick, handlers } = useCardGesture(ref, {
    ...gesture,
    revealed,
    leftWidth,
    rightWidth,
    disabled: inactive,
  });
  const offset = drag ?? revealOffset(revealed, leftWidth, rightWidth);

  const tile = (target: MonitorSection | 'archive', side: RevealSide) => {
    const open = revealed === side;
    if (target === 'archive')
      return (
        <button
          key="archive"
          type="button"
          data-swipe-action
          data-target="archive"
          className="swipe-card__tile swipe-card__tile--archive"
          tabIndex={open ? 0 : -1}
          aria-hidden={!open}
          aria-label={t('monitor.lanes.archiveTask', { id: taskId })}
          onClick={onArchive}
        >
          <Trash2Icon aria-hidden="true" />
        </button>
      );
    const Icon = SECTION_ICONS[target];
    return (
      <button
        key={target}
        type="button"
        data-swipe-action
        data-target={target}
        className="swipe-card__tile"
        tabIndex={open ? 0 : -1}
        aria-hidden={!open}
        aria-label={t('monitor.lanes.moveTask', {
          id: taskId,
          lane: t(`monitor.status.${target}`),
        })}
        onClick={() => onMove(target)}
      >
        <Icon aria-hidden="true" />
      </button>
    );
  };

  const side = (name: RevealSide, width: number, shown: boolean) => (
    <div
      className="swipe-card__actions"
      data-side={name}
      data-revealed={shown || undefined}
      style={
        {
          width: `${shown ? Math.min(width, Math.abs(offset)) : 0}px`,
          '--reveal': shown ? revealProgress(offset, width) : 0,
        } as CSSProperties
      }
    >
      {(name === 'left' ? actions.left : actions.right).map((target) => tile(target, name))}
    </div>
  );

  return (
    <div
      ref={ref}
      className="swipe-card"
      data-swipe-card={taskId}
      data-revealed={revealed ?? undefined}
      data-armed={gesture.armed || undefined}
      data-dragging={drag !== null || undefined}
      {...handlers}
      onClickCapture={(event) => {
        // The click that ends a swipe is not a tap; a tap on an open card closes it.
        const target = event.target as Element;
        if (target.closest('[data-swipe-action]')) return;
        if (consumesClick() || revealed !== null) {
          event.preventDefault();
          event.stopPropagation();
          if (revealed !== null && !consumesClick()) gesture.onRevealChange(null);
        }
      }}
    >
      {side('left', leftWidth, offset > 0)}
      {side('right', rightWidth, offset < 0)}
      <div
        className="swipe-card__body"
        style={offset !== 0 ? { transform: `translateX(${offset}px)` } : undefined}
      >
        {children}
      </div>
    </div>
  );
}
