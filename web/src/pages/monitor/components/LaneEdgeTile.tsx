import type { LucideIcon } from 'lucide-react';
import type { CSSProperties } from 'react';
import { revealProgress } from '@/shared/lib/gesture/cardReveal';
import { BULK_WIDTH } from '../hooks/useLaneOverscroll';
import './monitor-lanes.css';

/**
 * The tile an end lane uncovers beside it while it follows an overscroll swipe, the same look as a
 * card's tile. It is shown while the lane is dragged toward `side`; it takes no press and is hidden from assistive
 * technology.
 */
export function LaneEdgeTile({
  offset,
  side,
  icon: Icon,
  archive = false,
}: {
  /** How far (px) the lane has followed the finger: negative to the left, positive to the right. */
  offset: number;
  /** The side the tile sits on: right for a lane dragged left, left for a lane dragged right. */
  side: 'left' | 'right';
  icon: LucideIcon;
  /** The tile has the archive look (the Archive all tile). */
  archive?: boolean;
}) {
  const shown = side === 'right' ? offset < 0 : offset > 0;
  return (
    <div
      className="swipe-card__actions"
      data-side={side}
      data-revealed={shown || undefined}
      data-bulk-tile=""
      aria-hidden="true"
      style={
        {
          width: `${shown ? Math.min(BULK_WIDTH, Math.abs(offset)) : 0}px`,
          '--reveal': shown ? revealProgress(offset, BULK_WIDTH) : 0,
          pointerEvents: 'none',
        } as CSSProperties
      }
    >
      <div className={`swipe-card__tile${archive ? ' swipe-card__tile--archive' : ''}`}>
        <Icon aria-hidden="true" />
      </div>
    </div>
  );
}
